import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  jsonResponse,
  errorResponse,
  preflight,
  isLocalEngineRequest,
} from "@/lib/api";
import { getCallerContext, canAccessTargetId } from "@/lib/authContext";
import { resolvePlanKey, trackerPlanKey, ensureCurrentSeasonPlan, ensurePlanZLevel } from "@/lib/plans";
import { CURRENT_SEASON, SEASON_SOURCE_TARGET_IDS, isCurrentSeason } from "@/lib/season";

// Premier identifiant d'entité du moteur (famille « building ») : au-delà
// de 19 999 999, ce n'est plus un personnage.
const ENTITY_ID_MIN = 20000000;

// Étendue d'une image composée, en cases (1 à 8) : un bâtiment 2×2 du jeu.
const span = (v) => (Number.isInteger(v) && v >= 1 && v <= 8 ? v : 1);

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

    // Seules les vues de Medarda et de Neige font la carte de la saison en
    // cours (les archives, elles, ne reçoivent plus rien). Le moteur local
    // est une copie de la saison 2 : ses relevés n'ont pas leur place ici.
    if (!SEASON_SOURCE_TARGET_IDS.includes(ownerId)) {
      return errorResponse(
        `Season ${CURRENT_SEASON} map ingest is limited to targetId ${SEASON_SOURCE_TARGET_IDS.join(" or ")}`,
        403,
        origin
      );
    }

    // Le moteur local est une copie de la saison 2 : ses relevés n'ont pas
    // leur place sur la carte de la saison en cours. (Le reste de l'ingest
    // garde ses égards pour lui, prêt pour le jour où il tournera en saison
    // courante.) Et l'appelant doit posséder la persona qu'il annonce, pour
    // qu'un jeton égaré ne signe pas de cartographie en son nom.
    const fromLocalEngine = isLocalEngineRequest(request);
    if (fromLocalEngine) {
      return errorResponse(`Local engine is not season ${CURRENT_SEASON}: ingest refused`, 403, origin);
    }
    if (!canAccessTargetId(ctx, ownerId)) {
      return errorResponse("Forbidden", 403, origin);
    }

    // L'identité du plan : la clé du moteur, que l'extension lit dans le nom
    // des calques de map.php?local (« olympia » sur le monde). Elle seule
    // distingue deux homonymes ; un plan ou un niveau jamais vu est créé.
    // Une extension qui ne l'envoie pas encore retombe sur le nom affiché,
    // résolu parmi les plans déjà connus de la saison, sans rien créer.
    const planKey = trackerPlanKey(body.planKey);
    if (planKey) {
      const ensured = await ensureCurrentSeasonPlan(planKey, body.planDisplayName ?? null);
      if (!ensured) {
        return errorResponse(`Plan "${planKey}" belongs to a closed season`, 422, origin);
      }
      plan = ensured;
    } else if (body.planDisplayName) {
      const resolved = await resolvePlanKey({
        planDisplayName: body.planDisplayName,
        zName: body.zName ?? null,
        z,
        x: body.playerCoords?.x ?? null,
        y: body.playerCoords?.y ?? null,
      });
      if (resolved) plan = resolved;
    }

    // Refuse to file cartography under an identity we can't stand behind.
    // Unresolved displayName lookups (above) and pre-displayName extensions
    // both leave `plan` as the raw background-image slug (sky/noir/
    // underground/…) — several unrelated real locations share the same
    // backdrop, so writing under it doesn't just mislabel one place, it
    // splices distinct plans' coordinates into one bucket. Every real plan
    // is seeded ahead of time (see pnpm seed-plans), so failing to find it
    // here means the identity is bogus, not just not-yet-seeded.
    const knownPlan = await prisma.plan.findFirst({ where: { name: plan }, select: { name: true, season: true } });
    if (!knownPlan || !isCurrentSeason(knownPlan.season)) {
      logger.warn(
        `Rejecting map ingest: unresolved plan "${plan}" (displayName="${body.planDisplayName || ""}" zName="${body.zName || ""}" z=${z})`
      );
      return errorResponse(`Unresolved plan "${plan}"`, 422, origin);
    }

    await ensurePlanZLevel(plan, z, body.zName ?? null);

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
    // The local engine contributes terrain, never presence: who walks its
    // streets is dev data, and taking it in would move characters on the
    // tracker's map to places they've never been.
    // Saison 3 : murs, coffres, arbres sont des entités dont l'identifiant
    // part de 20 000 000 (ENTITY_ID_RANGES du moteur). Une extension qui les
    // prend encore pour des personnages ne doit pas en faire des fiches.
    const players = fromLocalEngine
      ? []
      : Array.isArray(body.players)
        ? body.players.filter((p) => p.targetId == null || p.targetId < ENTITY_ID_MIN)
        : [];

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
      const data = { coordsId, name: w.name, href: w.href || null, damages: w.damages ?? 0, w: span(w.w), h: span(w.h) };
      await prisma.mapWalls.upsert({
        where: { coordsId_name: { coordsId, name: w.name } },
        create: data,
        update: { href: data.href, damages: data.damages, w: data.w, h: data.h },
      });
      counts.walls++;
    }
    for (const e of elements) {
      if (!e.name) continue;
      const coordsId = coordIdByXY.get(`${e.x},${e.y}`);
      if (!coordsId) continue;
      const data = {
        coordsId, name: e.name, href: e.href || null, opacity: e.opacity ?? 1.0, w: span(e.w), h: span(e.h),
        edge: Number.isInteger(e.edge) && e.edge >= 0 && e.edge <= 255 ? e.edge : 0,
        half: typeof e.half === "string" && /^[NESW]{3}$/.test(e.half) ? e.half : null,
      };
      await prisma.mapElements.upsert({
        where: { name_coordsId: { name: e.name, coordsId } },
        create: data,
        update: { href: data.href, opacity: data.opacity, w: data.w, h: data.h, edge: data.edge, half: data.half },
      });
      counts.elements++;
    }
    for (const f of foregrounds) {
      if (!f.name) continue;
      const coordsId = coordIdByXY.get(`${f.x},${f.y}`);
      if (!coordsId) continue;
      const data = { coordsId, name: f.name, href: f.href || null, w: span(f.w), h: span(f.h) };
      await prisma.mapForegrounds.upsert({
        where: { coordsId_name: { coordsId, name: f.name } },
        create: data,
        update: { href: data.href, w: data.w, h: data.h },
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
    // Skipped for the local engine: its scrape carries no players, so
    // reconciling would read "nobody is here" and clear every position the
    // real game had recorded on those cells.
    if (observedIds.length > 0 && !fromLocalEngine) {
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

    logger.info(
      `Map ingest by ${ctx.username}${fromLocalEngine ? " (local engine, terrain only)" : ""}:`,
      { ...counts, removed }
    );
    // Le plan résolu fait partie de la réponse : l'extension ne sait pas le
    // déduire elle-même (elle n'a que le nom affiché), et l'arpentage
    // automatique en a besoin pour demander où aller ensuite.
    return jsonResponse({ ok: true, plan, z, counts, removed }, { origin });
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
    // Sur un plan de la saison en cours, ce que voient les sources de la
    // saison (Neige comprise, bien que PNJ) fait foi : c'est du canon.
    const planRow = await prisma.plan.findUnique({ where: { name: plan }, select: { season: true } });
    const canonIds = planRow && isCurrentSeason(planRow.season) ? SEASON_SOURCE_TARGET_IDS : [];
    const coordsList = await prisma.coords.findMany({
      where: {
        plan,
        z,
        OR: [
          { seenById: null },
          { seenById: { gte: 0 } },
          { seenById: { in: [...ownTargetIds, ...canonIds] } },
        ],
      },
      select: { id: true, x: true, y: true, seenById: true },
    });
    const ownerOf = (seenById) => (seenById == null || canonIds.includes(seenById) ? null : seenById);
    const coordsById = new Map(
      coordsList.map((c) => [c.id, { x: c.x, y: c.y, owner: ownerOf(c.seenById) }])
    );
    const ids = [...coordsById.keys()];

    // Persona layers present at this plan/z that belong to the caller (the
    // PNJ personas whose cartography can be toggled on over the canon map).
    const pnjOwnerIds = [
      ...new Set(
        coordsList
          .map((c) => c.seenById)
          .filter((s) => s != null && s < 0 && ownTargetIds.includes(s) && !canonIds.includes(s))
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
