import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext } from "@/lib/authContext";

// POST: ingest a scraped map fragment.
// Body shape:
// {
//   plan: "gaia",
//   z: 0,
//   tiles:       [{ x, y, name, foreground? }],
//   walls:       [{ x, y, name, damages? }],
//   elements:    [{ x, y, name, opacity? }],
//   foregrounds: [{ x, y, name }],
//   routes:      [{ x, y, name }],
//   plants:      [{ x, y, name }],
//   players:     [{ x, y, targetId, color? }], // color = race-hint bgColor
//   observedCells: [{ x, y }], // cells fully seen this scrape (no fog)
//   ownerId:     -260,   // persona that scraped this (negative = PNJ)
// }
export async function POST(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const body = await request.json();
    let plan = body.plan || "gaia";
    const z = body.z ?? 0;

    // Persona that scraped this fragment (AOM targetId). Negative = PNJ.
    // Falls back to the caller's active "acting as" persona when the extension
    // didn't tag the payload (older versions). Used to segregate PNJ vision.
    const ownerId =
      typeof body.ownerId === "number" && Number.isFinite(body.ownerId)
        ? body.ownerId
        : ctx.actingAsTargetId ?? null;
    const ownerIsPnj = ownerId != null && ownerId < 0;

    // The extension's bg-image-derived plan is unreliable (some plans share
    // a bg image with another, e.g. taverne_d_olympia_s2 -> campement_redoraan.png).
    // When the extension can read map.php?local's position panel, it sends
    // the displayName (and z-level name as a tie-breaker) — resolve those
    // to the canonical plan key from the seeded Plan/PlanZLevel tables.
    if (body.planDisplayName) {
      const candidates = await prisma.plan.findMany({
        where: { displayName: body.planDisplayName },
        include: { zLevels: true },
      });
      const px = body.playerCoords?.x;
      const py = body.playerCoords?.y;
      const inBounds = (zl, x, y) =>
        zl.visibleBoundsMinX != null && zl.visibleBoundsMaxX != null &&
        zl.visibleBoundsMinY != null && zl.visibleBoundsMaxY != null &&
        x >= zl.visibleBoundsMinX && x <= zl.visibleBoundsMaxX &&
        y >= zl.visibleBoundsMinY && y <= zl.visibleBoundsMaxY;

      let resolved = null;
      if (candidates.length === 1) {
        resolved = candidates[0];
      } else if (candidates.length > 1) {
        // Prefer a plan whose z-level matches both z and the (named) z-name.
        // local_map.php only renders the z-name when a plan has >1 z-level,
        // so for single-z plans body.zName is empty — fall through to the
        // next tie-breakers in that case.
        if (body.zName) {
          resolved =
            candidates.find((p) =>
              p.zLevels.some((zl) => zl.z === z && zl.zName === body.zName)
            ) || null;
        }
        // Bounds tie-breaker: which plan's z-level contains the player coords?
        if (!resolved && px != null && py != null) {
          resolved =
            candidates.find((p) =>
              p.zLevels.some((zl) => zl.z === z && inBounds(zl, px, py))
            ) || null;
        }
        // Season tie-breaker: the active season is "s2", so when the
        // displayName is shared by a legacy and an s2 variant, prefer s2.
        // (The world map "olympia" is the only plan with no _s2 sibling.)
        if (!resolved) {
          resolved = candidates.find((p) => p.name.endsWith("_s2")) || null;
        }
      }
      if (resolved) {
        plan = resolved.name;
      } else {
        logger.warn(
          `Could not resolve plan key from displayName="${body.planDisplayName}" zName="${body.zName}" z=${z}; falling back to "${plan}"`
        );
      }
    }

    // Persist the per-z backdrop the extension read off the SVG container
    // (e.g. img/tiles/sky.webp for the Remparts). updateMany is a no-op when
    // the (plan, z) row isn't seeded, so it never throws.
    if (typeof body.background === "string" && body.background.trim()) {
      await prisma.planZLevel.updateMany({
        where: { planName: plan, z },
        data: { bg: body.background.trim() },
      });
    }

    const tiles = Array.isArray(body.tiles) ? body.tiles : [];
    const walls = Array.isArray(body.walls) ? body.walls : [];
    // Defense in depth: drop ephemeral footprint traces if an older extension
    // version still sends them (the current one filters client-side too).
    const elements = (Array.isArray(body.elements) ? body.elements : [])
      .filter((e) => e.name && !String(e.name).startsWith("trace_pas"));
    // Defense in depth: drop the perception-fog overlay foreground
    // (img/foregrounds/ombre.png). Older extensions still send it.
    const foregrounds = (Array.isArray(body.foregrounds) ? body.foregrounds : [])
      .filter((f) => f.name && String(f.name) !== "ombre");
    const routes = Array.isArray(body.routes) ? body.routes : [];
    const plants = Array.isArray(body.plants) ? body.plants : [];
    const players = Array.isArray(body.players) ? body.players : [];

    // Step 1: upsert all unique (x,y,z,plan) coords used in this batch.
    const allPoints = [
      ...tiles, ...walls, ...elements, ...foregrounds, ...routes, ...plants, ...players,
    ].map((p) => `${p.x},${p.y}`);
    const uniquePoints = Array.from(new Set(allPoints)).map((s) => {
      const [x, y] = s.split(",").map(Number);
      return { x, y };
    });

    // Sequential upsert (SQLite: parallel writes don't help and may serialize).
    // seenById rule (see schema): a PJ scrape always (re)claims the cell as
    // canon; a PNJ only tags cells that are still unclaimed, so it can never
    // downgrade — or pollute — a cell the main PJ has already seen.
    const coordIdByXY = new Map();
    for (const { x, y } of uniquePoints) {
      const c = await prisma.coords.upsert({
        where: { x_y_z_plan: { x, y, z, plan } },
        create: { x, y, z, plan, seenById: ownerId },
        update: {},
      });
      coordIdByXY.set(`${x},${y}`, c.id);
      // c.seenById is the value before this batch (upsert "update: {}" is a
      // no-op on an existing row; on create it equals ownerId already).
      const shouldClaim = ownerId != null && (
        ownerIsPnj ? c.seenById == null      // PNJ: only unclaimed cells
                   : c.seenById !== ownerId  // PJ: (re)claim as canon
      );
      if (shouldClaim) {
        await prisma.coords.update({ where: { id: c.id }, data: { seenById: ownerId } });
      }
    }

    // Step 2: upsert each layer.
    let counts = { tiles: 0, walls: 0, elements: 0, foregrounds: 0, routes: 0, plants: 0, players: 0 };

    for (const t of tiles) {
      if (!t.name) continue;
      const coordsId = coordIdByXY.get(`${t.x},${t.y}`);
      if (!coordsId) continue;
      const data = { coordsId, name: t.name, href: t.href || null, foreground: t.foreground ?? 0 };
      await prisma.mapTiles.upsert({
        where: { coordsId_name: { coordsId, name: t.name } },
        create: data,
        update: { href: data.href, foreground: data.foreground },
      });
      counts.tiles++;
    }
    for (const w of walls) {
      if (!w.name) continue;
      const coordsId = coordIdByXY.get(`${w.x},${w.y}`);
      if (!coordsId) continue;
      const data = { coordsId, name: w.name, href: w.href || null, damages: w.damages ?? 0 };
      await prisma.mapWalls.upsert({
        where: { coordsId_name: { coordsId, name: w.name } },
        create: data,
        update: { href: data.href, damages: data.damages },
      });
      counts.walls++;
    }
    for (const e of elements) {
      if (!e.name) continue;
      const coordsId = coordIdByXY.get(`${e.x},${e.y}`);
      if (!coordsId) continue;
      const data = { coordsId, name: e.name, href: e.href || null, opacity: e.opacity ?? 1.0 };
      await prisma.mapElements.upsert({
        where: { name_coordsId: { name: e.name, coordsId } },
        create: data,
        update: { href: data.href, opacity: data.opacity },
      });
      counts.elements++;
    }
    for (const f of foregrounds) {
      if (!f.name) continue;
      const coordsId = coordIdByXY.get(`${f.x},${f.y}`);
      if (!coordsId) continue;
      const data = { coordsId, name: f.name, href: f.href || null };
      await prisma.mapForegrounds.upsert({
        where: { coordsId_name: { coordsId, name: f.name } },
        create: data,
        update: { href: data.href },
      });
      counts.foregrounds++;
    }
    for (const r of routes) {
      if (!r.name) continue;
      const coordsId = coordIdByXY.get(`${r.x},${r.y}`);
      if (!coordsId) continue;
      const data = { coordsId, name: r.name, href: r.href || null };
      await prisma.mapRoutes.upsert({
        where: { coordsId_name: { coordsId, name: r.name } },
        create: data,
        update: { href: data.href },
      });
      counts.routes++;
    }
    for (const p of plants) {
      if (!p.name) continue;
      const coordsId = coordIdByXY.get(`${p.x},${p.y}`);
      if (!coordsId) continue;
      const data = { coordsId, name: p.name, href: p.href || null };
      await prisma.mapPlants.upsert({
        where: { coordsId_name: { coordsId, name: p.name } },
        create: data,
        update: { href: data.href },
      });
      counts.plants++;
    }
    // Step 3: reconcile observed cells. A scrape is ground truth for every
    // cell it fully saw (observedCells — fogged cells are excluded client-
    // side): any stored layer row on such a cell that's absent from this
    // payload no longer exists in game (destroyed barricade, harvested
    // plant, faded trace, …) and is deleted. Layer content is objective
    // world state — only Coords.seenById is persona-scoped — so a PNJ
    // scrape may remove rows on canon cells just like its upserts already
    // overwrite them. Old extensions don't send observedCells: ingest then
    // stays purely additive, as before.
    const observedCells = Array.isArray(body.observedCells) ? body.observedCells : [];
    // observedCells ⊆ tile cells, so they all resolved a coordsId above.
    const observedIds = observedCells
      .map((c) => coordIdByXY.get(`${c.x},${c.y}`))
      .filter((id) => id != null);
    const removed = { tiles: 0, walls: 0, elements: 0, foregrounds: 0, routes: 0, plants: 0, players: 0 };
    if (observedIds.length > 0) {
      const reconcile = async (model, rows) => {
        const keep = new Set();
        for (const r of rows) {
          if (!r.name) continue;
          const cid = coordIdByXY.get(`${r.x},${r.y}`);
          if (cid != null) keep.add(`${cid}|${r.name}`);
        }
        const existing = await model.findMany({
          where: { coordsId: { in: observedIds } },
          select: { id: true, coordsId: true, name: true },
        });
        const stale = existing
          .filter((e) => !keep.has(`${e.coordsId}|${e.name}`))
          .map((e) => e.id);
        if (stale.length > 0) {
          await model.deleteMany({ where: { id: { in: stale } } });
        }
        return stale.length;
      };
      removed.tiles = await reconcile(prisma.mapTiles, tiles);
      removed.walls = await reconcile(prisma.mapWalls, walls);
      removed.elements = await reconcile(prisma.mapElements, elements);
      removed.foregrounds = await reconcile(prisma.mapForegrounds, foregrounds);
      removed.routes = await reconcile(prisma.mapRoutes, routes);
      removed.plants = await reconcile(prisma.mapPlants, plants);
    }

    // Player positions: upsert so PNJs and players never imported as
    // Characters still show on the map — an unknown targetId gets a minimal
    // placeholder row ("PNJ -97" / "Joueur 57") that the character import
    // (POST /api/characters) fills in with real data later.
    for (const p of players) {
      if (p.targetId == null) continue;
      const coordsId = coordIdByXY.get(`${p.x},${p.y}`);
      if (!coordsId) continue;
      // Keep the stored color when the scrape has none (raceHint option off).
      const data = { coordsId, mapAvatarHref: p.href || null };
      if (p.color) data.mapColor = p.color;
      await prisma.characters.upsert({
        where: { targetId: p.targetId },
        create: {
          targetId: p.targetId,
          name: p.targetId < 0 ? `PNJ ${p.targetId}` : `Joueur ${p.targetId}`,
          ...data,
        },
        update: data,
      });
      counts.players++;
    }

    // Observed cells also reconcile positions: a character whose last known
    // position is on a cell this scrape fully saw, but who isn't in the
    // scrape's players, has left perception — their position is unknown now,
    // not "still there". Clear it so the map doesn't show a ghost. Runs after
    // the update loop so freshly-moved characters (in seenTargetIds) are
    // never touched.
    if (observedIds.length > 0) {
      const seenTargetIds = players
        .map((p) => p.targetId)
        .filter((t) => t != null);
      const res = await prisma.characters.updateMany({
        where: {
          coordsId: { in: observedIds },
          targetId: { notIn: seenTargetIds },
        },
        data: { coordsId: null },
      });
      removed.players = res.count;
    }

    logger.info(`Map ingest by ${ctx.username}:`, { ...counts, removed });
    return jsonResponse({ ok: true, counts, removed }, { origin });
  } catch (err) {
    logger.error(`Error ingesting map: ${err.message}`, { stack: err.stack });
    return errorResponse("Failed to ingest map", 500, origin);
  }
}

// GET: return the full accumulated map for a plan (default "gaia") +
// players' last known positions.
export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const { searchParams } = new URL(request.url);
    const plan = searchParams.get("plan") || "gaia";
    const z = parseInt(searchParams.get("z") || "0", 10);

    // Vision scoping: return canon cells (NULL or PJ-seen, seenById >= 0) plus
    // any cell one of the caller's OWN personas (incl. their PNJs) has seen.
    // Other users' PNJ scribbles are never returned — no leak, no pollution.
    const ownTargetIds = ctx.characterTargetIds ?? [];
    const coordsList = await prisma.coords.findMany({
      where: {
        plan,
        z,
        OR: [
          { seenById: null },
          { seenById: { gte: 0 } },
          { seenById: { in: ownTargetIds } },
        ],
      },
      select: { id: true, x: true, y: true, seenById: true },
    });
    const coordsById = new Map(
      coordsList.map((c) => [c.id, { x: c.x, y: c.y, owner: c.seenById ?? null }])
    );
    const ids = [...coordsById.keys()];

    // Persona layers present at this plan/z that belong to the caller (the
    // PNJ personas whose cartography can be toggled on over the canon map).
    const pnjOwnerIds = [
      ...new Set(
        coordsList
          .map((c) => c.seenById)
          .filter((s) => s != null && s < 0 && ownTargetIds.includes(s))
      ),
    ];
    let personaLayers = [];
    if (pnjOwnerIds.length > 0) {
      const named = await prisma.characters.findMany({
        where: { targetId: { in: pnjOwnerIds } },
        select: { targetId: true, name: true },
      });
      const nameByTargetId = new Map(named.map((c) => [c.targetId, c.name]));
      // Always surface a toggle for every PNJ that has cells here, even if the
      // PNJ isn't imported as a Character yet — otherwise its cartography would
      // be stuck hidden with no way to reveal it.
      personaLayers = pnjOwnerIds.map((targetId) => ({
        targetId,
        name: nameByTargetId.get(targetId) || `PNJ ${targetId}`,
      }));
    }

    const [tiles, walls, elements, foregrounds, routes, plants, charactersHere] = await Promise.all([
      prisma.mapTiles.findMany({ where: { coordsId: { in: ids } } }),
      prisma.mapWalls.findMany({ where: { coordsId: { in: ids } } }),
      prisma.mapElements.findMany({ where: { coordsId: { in: ids } } }),
      prisma.mapForegrounds.findMany({ where: { coordsId: { in: ids } } }),
      prisma.mapRoutes.findMany({ where: { coordsId: { in: ids } } }),
      prisma.mapPlants.findMany({ where: { coordsId: { in: ids } } }),
      prisma.characters.findMany({
        where: { coordsId: { in: ids } },
        select: {
          id: true, targetId: true, name: true,
          portraitUrl: true, mapAvatarHref: true, mapColor: true,
          coordsId: true, faction: { select: { name: true } },
        },
      }),
    ]);

    const withCoords = (rows) =>
      rows.map((r) => ({ ...r, ...coordsById.get(r.coordsId) }));

    return jsonResponse(
      {
        plan,
        z,
        personaLayers,
        tiles: withCoords(tiles),
        walls: withCoords(walls),
        elements: withCoords(elements),
        foregrounds: withCoords(foregrounds),
        routes: withCoords(routes),
        plants: withCoords(plants),
        players: charactersHere.map((c) => ({
          ...coordsById.get(c.coordsId),
          targetId: c.targetId,
          name: c.name,
          href: c.mapAvatarHref || c.portraitUrl, // map sprite preferred
          portraitUrl: c.portraitUrl,
          color: c.mapColor || null,
          faction: c.faction?.name || null,
        })),
      },
      { origin }
    );
  } catch (err) {
    logger.error(`Error fetching map: ${err.message}`, { stack: err.stack });
    return errorResponse("Failed to fetch map", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
