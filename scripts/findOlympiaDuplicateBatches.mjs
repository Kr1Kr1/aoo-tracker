// Repère, sur `olympia`, tout lot d'un seul scrape (même scrapedAt à la
// seconde près) qui duplique EXACTEMENT (même x,y,name, toutes couches) les
// données d'un AUTRE plan — la signature du bug de collision Olympia/lieu
// hébergé (cf. Temple, conversation du 2026-08-29). Lecture seule.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const COUCHES = ["mapTiles", "mapWalls", "mapElements", "mapRoutes", "mapPlants", "mapForegrounds"];

function secondKey(date) {
  return Math.floor(date.getTime() / 1000);
}

async function main() {
  // Index global : "model|x|y|name" -> Set(plan), pour tout SAUF olympia.
  const index = new Map();
  for (const model of COUCHES) {
    const rows = await prisma[model].findMany({
      where: { coords: { plan: { not: "olympia" } } },
      select: { name: true, coords: { select: { x: true, y: true, plan: true } } },
    });
    for (const r of rows) {
      const key = `${model}|${r.coords.x}|${r.coords.y}|${r.name}`;
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(r.coords.plan);
    }
  }

  // Lignes olympia, groupées par seconde de scrapedAt.
  const bySecond = new Map();
  for (const model of COUCHES) {
    const rows = await prisma[model].findMany({
      where: { coords: { plan: "olympia" } },
      select: { name: true, scrapedAt: true, coords: { select: { x: true, y: true } } },
    });
    for (const r of rows) {
      const key = secondKey(r.scrapedAt);
      if (!bySecond.has(key)) bySecond.set(key, []);
      bySecond.get(key).push({ model, x: r.coords.x, y: r.coords.y, name: r.name });
    }
  }

  const batches = [...bySecond.entries()].filter(([, rows]) => rows.length >= 8);
  console.log(`${batches.length} lot(s) de >=8 lignes sur olympia à examiner.\n`);

  for (const [second, rows] of batches.sort((a, b) => a[0] - b[0])) {
    const planCounts = new Map(); // plan -> matched count
    for (const r of rows) {
      const key = `${r.model}|${r.x}|${r.y}|${r.name}`;
      const plans = index.get(key);
      if (!plans) continue;
      for (const p of plans) planCounts.set(p, (planCounts.get(p) ?? 0) + 1);
    }
    let best = null;
    for (const [plan, matched] of planCounts) {
      const ratio = matched / rows.length;
      if (!best || ratio > best.ratio) best = { plan, ratio, matched };
    }
    const date = new Date(second * 1000).toISOString();
    if (best && best.ratio >= 0.8) {
      console.log(`${date} — ${rows.length} lignes — ${Math.round(best.ratio * 100)}% dupliquées sur "${best.plan}" (${best.matched}/${rows.length})`);
    } else {
      console.log(`${date} — ${rows.length} lignes — pas de doublon net (meilleur: ${best?.plan ?? "aucun"} ${best ? Math.round(best.ratio * 100) : 0}%)`);
    }
  }
}

main().finally(() => prisma.$disconnect());
