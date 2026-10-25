// Nettoie les relevés versés sous un plan jamais résolu.
//
// Quand l'extension ne peut pas lire map.php?local (ou que la résolution par
// displayName échoue), le relevé retombait sur le nom du fond générique
// (img/tiles/sky.webp -> "sky", etc.) au lieu du vrai plan. Ces fonds sont
// partagés par plusieurs lieux réels sans rapport, donc le bucket mélange
// des coordonnées de lieux différents plutôt que de juste mal étiqueter un
// seul lieu (cf. app/api/maps/route.js, qui refuse maintenant ce cas).
//
// "banque_des_lutins" est dans le même sac : un seul propriétaire (-92) mais
// ses tuiles viennent de 7 fonds réels différents (havres, eryn_dolen,
// lac_pegasus, lac_cenedril, praetorium, pit, echelle) — pas de fichier
// correspondant dans les plans seedés de l'engine non plus. Vraisemblablement
// un ancien nom de secours (avant "gaia") utilisé par une version antérieure
// de l'extension, plutôt qu'un vrai plan isolé.
//
//   node scripts/cleanUnresolvedPlanPollution.mjs           # liste, ne touche à rien
//   node scripts/cleanUnresolvedPlanPollution.mjs --apply   # supprime

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BOGUS_PLANS = ["gaia", "sky", "noir", "underground", "pnjs", "banque_des_lutins"];
const apply = process.argv.includes("--apply");

const COUCHES = [
  ["mapTiles", "tuiles"],
  ["mapWalls", "murs"],
  ["mapElements", "éléments"],
  ["mapForegrounds", "premiers plans"],
  ["mapRoutes", "routes"],
  ["mapPlants", "plantes"],
];

async function main() {
  const cells = await prisma.coords.findMany({
    where: { plan: { in: BOGUS_PLANS } },
    select: { id: true, plan: true, z: true, seenById: true },
  });
  const ids = cells.map((c) => c.id);
  console.log(`${ids.length} cellules sur ${BOGUS_PLANS.join(", ")}`);
  if (ids.length === 0) return;

  const byPlan = new Map();
  for (const c of cells) byPlan.set(c.plan, (byPlan.get(c.plan) || 0) + 1);
  for (const [plan, n] of byPlan) console.log(`  ${plan} : ${n} cellules`);

  let total = 0;
  for (const [modele, label] of COUCHES) {
    const count = await prisma[modele].count({ where: { coordsId: { in: ids } } });
    if (count === 0) continue;
    total += count;
    console.log(`  ${label} : ${count}`);
    if (apply) await prisma[modele].deleteMany({ where: { coordsId: { in: ids } } });
  }

  const persos = await prisma.characters.count({ where: { coordsId: { in: ids } } });
  if (persos > 0) {
    console.log(`  personnages positionnés ici : ${persos} (position remise à null)`);
    if (apply) {
      await prisma.characters.updateMany({ where: { coordsId: { in: ids } }, data: { coordsId: null } });
    }
  }

  if (apply) {
    await prisma.coords.deleteMany({ where: { id: { in: ids } } });
    console.log(`Supprimé : ${total} lignes de couches, ${ids.length} cellules.`);
  } else {
    console.log(`${total} lignes de couches + ${ids.length} cellules à retirer (relancer avec --apply).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
