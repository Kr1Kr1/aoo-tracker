import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { CURRENT_SEASON } from '@/lib/season';

// Retrouver la clé d'un plan à partir de ce que la page du jeu en dit.
//
// L'extension ne lit que le nom affiché sur map.php?local (« Olympia »,
// « Taverne »…), le niveau et sa position. Plusieurs plans partagent un nom
// affiché (taverne d'ici et taverne de là, et les archives des saisons closes,
// écartées d'office), d'où les départages ci-dessous, dans cet ordre : un nom
// de niveau qui n'existe que sur un seul plan ; un seul candidat ; le niveau
// nommé ; les bornes du niveau qui contiennent la position. Null quand rien ne
// tient : l'appelant décide quoi en faire.

export type PlanHint = {
  planDisplayName: string;
  zName?: string | null;
  z: number;
  x?: number | null;
  y?: number | null;
};

type ZLevelBounds = {
  z: number;
  zName: string | null;
  visibleBoundsMinX: number | null;
  visibleBoundsMaxX: number | null;
  visibleBoundsMinY: number | null;
  visibleBoundsMaxY: number | null;
};

function inBounds(zl: ZLevelBounds, x: number, y: number): boolean {
  return (
    zl.visibleBoundsMinX != null &&
    zl.visibleBoundsMaxX != null &&
    zl.visibleBoundsMinY != null &&
    zl.visibleBoundsMaxY != null &&
    x >= zl.visibleBoundsMinX &&
    x <= zl.visibleBoundsMaxX &&
    y >= zl.visibleBoundsMinY &&
    y <= zl.visibleBoundsMaxY
  );
}

export async function resolvePlanKey(hint: PlanHint): Promise<string | null> {
  const { planDisplayName, zName, z } = hint;
  const px = hint.x ?? null;
  const py = hint.y ?? null;

  // Un niveau nommé imbriqué (temple_s2 z0 « Temple ») annonce le nom du plan
  // hôte, pas le sien : quand son nom de niveau ne désigne qu'un seul plan,
  // c'est lui, avant même de regarder le nom affiché.
  if (zName) {
    const zMatches = await prisma.planZLevel.findMany({
      where: { z, zName, plan: { OR: [{ season: null }, { season: CURRENT_SEASON }] } },
      select: { planName: true },
    });
    const uniquePlanNames = [...new Set(zMatches.map((m) => m.planName))];
    if (uniquePlanNames.length === 1) return uniquePlanNames[0];
  }

  // Une archive (saison close) partage son nom affiché avec le plan qui l'a
  // remplacé : seuls les plans de la saison en cours reçoivent des relevés.
  const candidates = await prisma.plan.findMany({
    where: {
      displayName: planDisplayName,
      OR: [{ season: null }, { season: CURRENT_SEASON }],
    },
    include: { zLevels: true },
  });
  if (candidates.length === 1) return candidates[0].name;
  if (candidates.length === 0) return null;

  // local_map.php n'affiche le nom du niveau que si le plan en a plusieurs :
  // pour un plan à un seul niveau, zName est vide et on passe au suivant.
  if (zName) {
    const byZName = candidates.find((p) => p.zLevels.some((zl) => zl.z === z && zl.zName === zName));
    if (byZName) return byZName.name;
  }
  if (px != null && py != null) {
    const byBounds = candidates.find((p) => p.zLevels.some((zl) => zl.z === z && inBounds(zl, px, py)));
    if (byBounds) return byBounds.name;
  }
  logger.warn(`Could not resolve plan key from displayName="${planDisplayName}" zName="${zName ?? ''}" z=${z}`);
  return null;
}

// Saison en cours : on ne sème rien d'avance, c'est le scraper qui fait
// découvrir le monde. L'extension lit la clé du plan dans le nom des calques
// de la carte locale (local_praetorium_s3_-1_tiles_….png), ou « olympia »
// sur le monde : un plan inconnu est créé, un niveau inconnu aussi. Les
// bornes restent vides, la carte se dessine à partir des cases relevées.

/**
 * La clé tracker d'un plan d'après la clé du moteur : le suffixe de la
 * saison en cours tombe (praetorium_s3 → praetorium), comme le fera la
 * cérémonie de renommage du moteur ; la carte ne se scinde pas le jour où
 * elle passe. Null pour une clé malformée.
 */
export function trackerPlanKey(enginePlanKey: unknown): string | null {
  if (typeof enginePlanKey !== 'string') return null;
  const key = enginePlanKey.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(key)) return null;
  return key.replace(new RegExp(`_s${CURRENT_SEASON}$`), '') || null;
}

/**
 * Le plan de la saison en cours qui porte cette clé, créé s'il est nouveau.
 * Null si la clé désigne une archive : une saison close ne reçoit plus rien.
 */
export async function ensureCurrentSeasonPlan(name: string, displayName?: string | null): Promise<string | null> {
  const existing = await prisma.plan.findUnique({ where: { name }, select: { season: true, displayName: true } });
  if (existing) {
    if (existing.season != null && existing.season !== CURRENT_SEASON) return null;
    // Un plan créé sans nom affiché le reçoit au premier relevé qui le porte.
    if (displayName && existing.displayName === name && displayName !== name) {
      await prisma.plan.update({ where: { name }, data: { displayName } });
    }
    return name;
  }
  await prisma.plan.create({ data: { name, displayName: displayName || name, season: CURRENT_SEASON } });
  logger.info(`New season ${CURRENT_SEASON} plan "${name}" (displayName="${displayName ?? ''}")`);
  return name;
}

/** Enregistre le niveau z d'un plan s'il n'existe pas encore, avec son nom s'il en a un. */
export async function ensurePlanZLevel(planName: string, z: number, zName?: string | null): Promise<void> {
  const existing = await prisma.planZLevel.findUnique({
    where: { planName_z: { planName, z } },
    select: { id: true, zName: true },
  });
  if (!existing) {
    await prisma.planZLevel.create({ data: { planName, z, zName: zName || null } });
    await prisma.plan.update({
      where: { name: planName },
      data: { numZLevels: await prisma.planZLevel.count({ where: { planName } }) },
    });
    logger.info(`New z-level ${z}${zName ? ` "${zName}"` : ''} on plan "${planName}"`);
  } else if (zName && !existing.zName) {
    await prisma.planZLevel.update({ where: { id: existing.id }, data: { zName } });
  }
}
