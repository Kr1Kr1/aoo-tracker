import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext } from "@/lib/authContext";

// Returns metadata for all known plans + the list of plans that have at
// least one Coords row (i.e. plans that have been actually scraped).
export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const [plans, scrapedZ] = await Promise.all([
      prisma.plan.findMany({
        orderBy: { displayName: "asc" },
        include: {
          zLevels: { orderBy: { z: "asc" } },
          exitsFrom: { select: { direction: true, planTo: true } },
        },
      }),
      // Distinct (plan, z) pairs from actually-scraped coordinates. Drives
      // both `hasData` and the z-level dropdown — see merge below.
      prisma.coords.findMany({
        select: { plan: true, z: true },
        distinct: ["plan", "z"],
      }),
    ]);

    const scraped = new Set(scrapedZ.map((c) => c.plan));
    const scrapedZByPlan = new Map();
    for (const { plan, z } of scrapedZ) {
      if (!scrapedZByPlan.has(plan)) scrapedZByPlan.set(plan, new Set());
      scrapedZByPlan.get(plan).add(z);
    }

    const enriched = plans.map((p) => {
      let meta = null;
      try {
        meta = p.metadata ? JSON.parse(p.metadata) : null;
      } catch {
        meta = null;
      }
      // bg field — engine convention (View.php) is to fall back to
      // img/tiles/{plan}.webp then img/tiles/{plan}.png when planJson.bg
      // isn't set. We can't probe the filesystem here so default to .png
      // (everything mirrored under public/assets/aom/img/tiles/ is .png).
      const bg = meta?.bg || `img/tiles/${p.name}.png`;

      // Merge in any z values that have scraped data but aren't declared in
      // the engine's plan JSON — happens when the seeded plan JSON is stale
      // (e.g. pyramide_s2 declares only z=0/-1 but the cellar at z=-2 was
      // added later and is scraped). Without this, those tiles are invisible
      // because the UI can't select that z.
      const declaredZ = new Set(p.zLevels.map((zl) => zl.z));
      const extraZ = [...(scrapedZByPlan.get(p.name) ?? [])]
        .filter((z) => !declaredZ.has(z))
        .sort((a, b) => a - b)
        .map((z) => ({
          z,
          zName: null,
          bg: null,
          visibleBoundsMinX: null,
          visibleBoundsMaxX: null,
          visibleBoundsMinY: null,
          visibleBoundsMaxY: null,
        }));
      const zLevels = [...p.zLevels, ...extraZ].sort((a, b) => a.z - b.z);

      return { ...p, zLevels, hasData: scraped.has(p.name), bg };
    });

    // Also surface plans we have data for that we don't have metadata for —
    // they show up as un-named entries.
    const unknownScraped = [...scraped].filter((n) => !plans.some((p) => p.name === n));
    for (const name of unknownScraped) {
      const zLevels = [...(scrapedZByPlan.get(name) ?? [])]
        .sort((a, b) => a - b)
        .map((z) => ({
          z,
          zName: null,
          bg: null,
          visibleBoundsMinX: null,
          visibleBoundsMaxX: null,
          visibleBoundsMinY: null,
          visibleBoundsMaxY: null,
        }));
      enriched.push({
        name,
        displayName: name,
        hasData: true,
        zLevels,
        exitsFrom: [],
        unknown: true,
      });
    }

    return jsonResponse({ plans: enriched }, { origin });
  } catch (err) {
    logger.error(`Error fetching plans: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
