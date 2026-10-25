// Clôture d'une saison : toutes les cartes connues deviennent des archives,
// les noms de base se libèrent pour la saison suivante, qui repart de zéro.
//
// Même cérémonie que PlanSeasonRenameService côté moteur : une archive porte
// sa saison en suffixe (olympia → olympia_s2), le plan de la saison courante
// a le nom de base. Seule différence : le tracker archive aussi Olympia et
// les Enfers, plans « de toutes saisons » pour le moteur, parce que leur
// carte change d'une saison à l'autre et qu'on ne veut pas mêler les relevés.
//
// Règles, pour un plan qui n'a pas encore de saison :
//   - suffixe _sN       → saison N, nom inchangé ;
//   - olympia, enfers   → saison close, suffixe _s<close> ;
//   - autre nom de base → saison 1 (convention du moteur), suffixe _s1.
// Un plan de la saison close sans suffixe le reçoit. Rejouable : un plan qui
// a déjà sa saison et son suffixe n'est pas touché.
//
// Le renommage suit le nom partout : Plan (et en cascade PlanZLevel,
// PlanExit), Coords, SurveyPoint, PlanPortal. Un plan dont le fond reposait
// sur le nom (img/tiles/<plan>.png) reçoit ce fond explicitement.
//
// Usage :  node scripts/archiveSeason.mjs <saison close> [--dry-run]
// Sauvegarder avant : pnpm db:backup

import { PrismaClient } from "@prisma/client";

const ALL_SEASONS = new Set(["olympia", "enfers"]);

const closing = parseInt(process.argv[2], 10);
const dryRun = process.argv.includes("--dry-run");
if (!Number.isInteger(closing) || closing < 1) {
  console.error("Usage: node scripts/archiveSeason.mjs <saison close> [--dry-run]");
  process.exit(1);
}

const prisma = new PrismaClient();

function plannedFor(plan) {
  const m = plan.name.match(/^(.+)_s(\d+)$/);
  if (m) return { season: plan.season ?? parseInt(m[2], 10), name: plan.name };
  if (plan.season != null && plan.season !== closing) return null; // saison courante d'un autre cycle
  const season = plan.season ?? (ALL_SEASONS.has(plan.name) ? closing : 1);
  return { season, name: `${plan.name}_s${season}` };
}

try {
  const plans = await prisma.plan.findMany({ orderBy: { name: "asc" } });
  const taken = new Set(plans.map((p) => p.name));
  const ops = [];
  for (const plan of plans) {
    const target = plannedFor(plan);
    if (!target) continue;
    if (target.name === plan.name && target.season === plan.season) continue;
    if (target.name !== plan.name && taken.has(target.name)) {
      console.warn(`✗ ${plan.name} → ${target.name} : nom déjà pris, à trancher à la main`);
      continue;
    }
    ops.push({ from: plan.name, to: target.name, season: target.season, metadata: plan.metadata });
  }

  for (const op of ops) {
    const label = op.from === op.to ? `${op.from} (saison ${op.season})` : `${op.from} → ${op.to} (saison ${op.season})`;
    if (dryRun) {
      console.log(`· ${label}`);
      continue;
    }
    let metadata = op.metadata;
    if (op.from !== op.to) {
      let meta = {};
      try { meta = metadata ? JSON.parse(metadata) : {}; } catch { meta = {}; }
      if (!meta.bg) {
        meta.bg = `img/tiles/${op.from}.png`;
        metadata = JSON.stringify(meta);
      }
    }
    await prisma.$transaction([
      prisma.plan.update({ where: { name: op.from }, data: { name: op.to, season: op.season, metadata } }),
      prisma.coords.updateMany({ where: { plan: op.from }, data: { plan: op.to } }),
      prisma.surveyPoint.updateMany({ where: { plan: op.from }, data: { plan: op.to } }),
      prisma.planPortal.updateMany({ where: { plan: op.from }, data: { plan: op.to } }),
      prisma.planPortal.updateMany({ where: { toPlan: op.from }, data: { toPlan: op.to } }),
    ]);
    console.log(`✓ ${label}`);
  }
  console.log(`${ops.length} plan(s) ${dryRun ? "à archiver" : "archivé(s)"}.`);
} finally {
  await prisma.$disconnect();
}
