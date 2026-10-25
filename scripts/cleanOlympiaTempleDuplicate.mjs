// Nettoie un relevé du 2026-08-23 07:41:42 versé par erreur sur `olympia`
// z0, alors qu'il décrit en réalité `temple_s2` z0 (« Temple ») — doublon à
// l'identique, vérifié couche par couche avant suppression (cf. conversation
// du 2026-08-29). Même mécanisme que cleanTempleReliquats.mjs : someone
// dans temple_s2 lit "Olympia / Niveau: Temple (Z0)" sur map.php?local,
// donc l'ancienne résolution par displayName tombait directement sur
// `olympia`. Corrigé dans app/api/maps/route.js.
//
//   node scripts/cleanOlympiaTempleDuplicate.mjs           # liste, ne touche à rien
//   node scripts/cleanOlympiaTempleDuplicate.mjs --apply   # supprime

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PLAN = "olympia";
const BATCH_START = new Date("2026-08-23T07:41:42.000Z");
const BATCH_END = new Date("2026-08-23T07:41:43.000Z");
const apply = process.argv.includes("--apply");

const COUCHES = [
  ["mapTiles", "tuiles"],
  ["mapWalls", "murs"],
  ["mapElements", "éléments"],
  ["mapRoutes", "routes"],
  ["mapPlants", "plantes"],
  ["mapForegrounds", "premiers plans"],
];

async function main() {
  let total = 0;
  const touchedCoordIds = new Set();

  for (const [modele, label] of COUCHES) {
    const where = {
      scrapedAt: { gte: BATCH_START, lt: BATCH_END },
      coords: { plan: PLAN },
    };
    const rows = await prisma[modele].findMany({
      where,
      include: { coords: { select: { id: true, x: true, y: true } } },
    });
    if (rows.length === 0) continue;
    total += rows.length;
    rows.forEach((r) => touchedCoordIds.add(r.coords.id));
    const detail = rows.map((r) => `${r.name}@${r.coords.x},${r.coords.y}`).sort().join(" ");
    console.log(`  ${label} : ${rows.length} → ${detail}`);
    if (apply) {
      await prisma[modele].deleteMany({
        where: { scrapedAt: { gte: BATCH_START, lt: BATCH_END }, coordsId: { in: rows.map((r) => r.coords.id) } },
      });
    }
  }

  if (total === 0) {
    console.log("Rien à retirer.");
    return;
  }

  // Une case que ce nettoyage a vidée de toutes ses couches n'a plus rien à
  // dire : elle ne doit pas rester à trouer la carte en case « vue mais vide ».
  if (apply) {
    const orphans = [];
    for (const id of touchedCoordIds) {
      const counts = await Promise.all(COUCHES.map(([m]) => prisma[m].count({ where: { coordsId: id } })));
      const chars = await prisma.characters.count({ where: { coordsId: id } });
      if (counts.reduce((a, b) => a + b, 0) + chars === 0) orphans.push(id);
    }
    if (orphans.length > 0) {
      await prisma.coords.deleteMany({ where: { id: { in: orphans } } });
      console.log(`Cases vidées supprimées : ${orphans.length}`);
    }
    console.log(`Supprimé : ${total} lignes.`);
  } else {
    console.log(`${total} lignes (sur ${touchedCoordIds.size} cases) à retirer (relancer avec --apply).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
