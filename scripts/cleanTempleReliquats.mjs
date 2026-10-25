// Nettoie le relevé du 2026-08-14 23:56:50 versé par erreur sur `temple_s2` z0.
//
// Ce lot décrit en réalité le Lac Reflet (`praetorium_s2` z-1) : les 17 tuiles
// `caverne`, les 3 murs et les 11 routes qu'il a posés se retrouvent à
// l'identique, coordonnée par coordonnée, sur praetorium_s2 z-1 et sur
// underground z0. Le nettoyage précédent n'avait retiré que les cellules vues
// par Neige (targetId -9) ; celles-là étaient signées Medarda et ont survécu.
//
// La signature du lot est son horodatage : `scrapedAt` est un @updatedAt, donc
// une cellule réarpentée depuis porte une date récente. Tout ce qui reste daté
// d'avant le 2026-08-15 sur ce plan vient du mauvais relevé.
//
//   node scripts/cleanTempleReliquats.mjs           # liste, ne touche à rien
//   node scripts/cleanTempleReliquats.mjs --apply   # supprime

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PLAN = "temple_s2";
const Z = 0;
const AVANT = new Date("2026-08-15T00:00:00Z");
const apply = process.argv.includes("--apply");

const COUCHES = [
  ["mapTiles", "tuiles"],
  ["mapWalls", "murs"],
  ["mapElements", "éléments"],
  ["mapRoutes", "routes"],
  ["mapPlants", "plantes"],
  ["mapForegrounds", "premiers plans"],
];

/** Les cellules qui ne portent plus aucune couche ni personnage. */
async function vides(ids) {
  const out = [];
  for (const id of ids) {
    const counts = await Promise.all([
      ...COUCHES.map(([modele]) => prisma[modele].count({ where: { coordsId: id } })),
      prisma.characters.count({ where: { coordsId: id } }),
    ]);
    if (counts.reduce((a, b) => a + b, 0) === 0) out.push(id);
  }
  return out;
}

async function main() {
  const cells = await prisma.coords.findMany({
    where: { plan: PLAN, z: Z },
    select: { id: true },
  });
  const ids = cells.map((c) => c.id);
  console.log(`${PLAN} z${Z} : ${ids.length} cellules`);

  // Des cases arpentées mais sans décor existent déjà (l'intérieur du temple,
  // que le relevé ne détaille pas) : elles ne regardent pas ce nettoyage.
  const videsAvant = new Set(await vides(ids));

  let total = 0;
  for (const [modele, label] of COUCHES) {
    const where = { coordsId: { in: ids }, scrapedAt: { lt: AVANT } };
    const rows = await prisma[modele].findMany({
      where,
      include: { coords: { select: { x: true, y: true } } },
    });
    if (rows.length === 0) continue;
    total += rows.length;
    const detail = rows
      .map((r) => `${r.name}@${r.coords.x},${r.coords.y}`)
      .sort()
      .join(" ");
    console.log(`  ${label} : ${rows.length} → ${detail}`);
    if (apply) await prisma[modele].deleteMany({ where });
  }

  if (total === 0) {
    console.log("Rien à retirer.");
  } else if (apply) {
    console.log(`Supprimé : ${total} lignes.`);
  } else {
    console.log(`${total} lignes à retirer (relancer avec --apply).`);
  }

  // Une cellule que ce nettoyage a vidée de toutes ses couches n'a plus rien à
  // dire : elle ne doit pas rester à trouer la carte en case « vue mais vide ».
  const orphelines = (await vides(ids)).filter((id) => !videsAvant.has(id));
  if (orphelines.length > 0) {
    const coords = await prisma.coords.findMany({
      where: { id: { in: orphelines } },
      select: { x: true, y: true },
    });
    console.log(
      `  cellules vidées : ${orphelines.length} → ${coords.map((c) => `${c.x},${c.y}`).join(" ")}`
    );
    if (apply) await prisma.coords.deleteMany({ where: { id: { in: orphelines } } });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
