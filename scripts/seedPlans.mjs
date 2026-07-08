// Reads every plan JSON from aoo-engine/datas/private/plans/ and seeds
// the Plan / PlanZLevel / PlanExit tables. Idempotent: re-runnable to
// pick up new or modified plans.
//
// Usage:  node scripts/seedPlans.mjs [path-to-plans-dir]
// Default path: /Users/kr1/age-of-olympia/aoo-engine/datas/private/plans

import { PrismaClient } from "@prisma/client";
import { readdir, readFile } from "fs/promises";
import path from "path";

const DEFAULT_DIR = "/Users/kr1/age-of-olympia/aoo-engine/datas/private/plans";
const dir = process.argv[2] || DEFAULT_DIR;

const prisma = new PrismaClient();

function fileNameToKey(filename) {
  return filename.replace(/\.json$/, "");
}

async function loadPlanJson(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    if (!raw.trim()) return null; // empty file — placeholder, skip silently
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`✗ Could not parse ${filePath}: ${err.message}`);
    return null;
  }
}

async function seedPlan(name, json) {
  const data = {
    name,
    displayName: json.name || name,
    shortName: json.shortName || null,
    worldX: typeof json.x === "number" ? json.x : null,
    worldY: typeof json.y === "number" ? json.y : null,
    visibleByDefault: !!json.visibleByDefault,
    visibleBoundsMinX: typeof json.visibleBoundsMinX === "number" ? json.visibleBoundsMinX : null,
    visibleBoundsMaxX: typeof json.visibleBoundsMaxX === "number" ? json.visibleBoundsMaxX : null,
    visibleBoundsMinY: typeof json.visibleBoundsMinY === "number" ? json.visibleBoundsMinY : null,
    visibleBoundsMaxY: typeof json.visibleBoundsMaxY === "number" ? json.visibleBoundsMaxY : null,
    numZLevels: json.num_z_levels || (json.z_levels?.length ?? 1),
    pnjSeedId: typeof json.pnj === "number" ? json.pnj : null,
    // Stuff bg into metadata so we don't need a migration. Engine fallback
    // (View.php): planJson.bg ?? `img/tiles/${planName}.webp` ?? `img/tiles/${planName}.png`.
    // We persist `bg` as-is and let the renderer guess the per-plan default
    // when it's null.
    metadata: JSON.stringify({
      biomes: json.biomes ?? null,
      bg: json.bg ?? null,
      mask: json.mask ?? null,
      scrollingMask: json.scrollingMask ?? null,
    }).slice(0, 50_000),
  };

  await prisma.plan.upsert({ where: { name }, create: data, update: data });

  // Replace z_levels: drop existing for this plan, recreate from JSON.
  await prisma.planZLevel.deleteMany({ where: { planName: name } });
  const zLevels = Array.isArray(json.z_levels) ? json.z_levels : null;
  if (zLevels && zLevels.length > 0) {
    for (const zl of zLevels) {
      await prisma.planZLevel.create({
        data: {
          planName: name,
          z: typeof zl.z === "number" ? zl.z : 0,
          zName: zl["z-name"] || zl.zName || null,
          visibleBoundsMinX: typeof zl.visibleBoundsMinX === "number" ? zl.visibleBoundsMinX : null,
          visibleBoundsMaxX: typeof zl.visibleBoundsMaxX === "number" ? zl.visibleBoundsMaxX : null,
          visibleBoundsMinY: typeof zl.visibleBoundsMinY === "number" ? zl.visibleBoundsMinY : null,
          visibleBoundsMaxY: typeof zl.visibleBoundsMaxY === "number" ? zl.visibleBoundsMaxY : null,
        },
      });
    }
  } else {
    // Create a single default z=0 level if none defined.
    await prisma.planZLevel.create({
      data: {
        planName: name,
        z: 0,
        visibleBoundsMinX: data.visibleBoundsMinX,
        visibleBoundsMaxX: data.visibleBoundsMaxX,
        visibleBoundsMinY: data.visibleBoundsMinY,
        visibleBoundsMaxY: data.visibleBoundsMaxY,
      },
    });
  }

  return zLevels?.length || 1;
}

async function seedExits(name, json) {
  await prisma.planExit.deleteMany({ where: { planFrom: name } });
  if (!json.exits || typeof json.exits !== "object") return 0;
  let count = 0;
  for (const [direction, list] of Object.entries(json.exits)) {
    if (!Array.isArray(list)) continue;
    for (const exit of list) {
      const target = exit?.plan;
      if (!target) continue;
      // Note: the target plan may not exist yet — we'll re-deleteMany+create
      // safely, but the FK requires it. Skip if it doesn't exist as Plan.
      const targetPlan = await prisma.plan.findUnique({ where: { name: target } });
      if (!targetPlan) continue;
      try {
        await prisma.planExit.create({
          data: { planFrom: name, planTo: target, direction },
        });
        count++;
      } catch (err) {
        // Likely duplicate — ignore
        if (err.code !== "P2002") throw err;
      }
    }
  }
  return count;
}

(async () => {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      console.error(`No JSON files found in ${dir}`);
      process.exit(1);
    }
    console.log(`Found ${files.length} plan files in ${dir}`);

    // First pass: seed all plans + z levels (so the FK targets exist before
    // we wire up exits).
    let plansSeeded = 0;
    let plansSkipped = 0;
    let totalZ = 0;
    for (const file of files) {
      const name = fileNameToKey(file);
      const json = await loadPlanJson(path.join(dir, file));
      if (!json) { plansSkipped++; continue; }
      const zCount = await seedPlan(name, json);
      totalZ += zCount;
      plansSeeded++;
    }

    // Second pass: exits (after every plan exists).
    let totalExits = 0;
    for (const file of files) {
      const name = fileNameToKey(file);
      const json = await loadPlanJson(path.join(dir, file));
      if (!json) continue;
      totalExits += await seedExits(name, json);
    }

    console.log(
      `✓ Seeded ${plansSeeded} plans (${plansSkipped} skipped — empty/malformed), ${totalZ} z-levels, ${totalExits} exits.`
    );
  } catch (err) {
    console.error("✗ Failed:", err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
