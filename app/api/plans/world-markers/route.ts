import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonResponse, errorResponse, preflight } from '@/lib/api';
import { getCallerContext } from '@/lib/authContext';
import { CURRENT_SEASON } from '@/lib/season';

// Les lieux à poser sur la carte du monde (map.php?world) : chaque plan qui
// a une position sur Olympia, groupé par case (une faille et sa sous-faille
// partagent l'entrée). Le jeu ne dessine que les lieux « visibles par
// défaut » ; l'extension complète avec les autres, d'où le drapeau.
//
// GET /api/plans/world-markers

const WORLD = 'olympia';
// Lieux secrets : ils existent dans les données, mais un personnage n'est pas
// censé les connaître avant de les avoir trouvés en jeu. L'île de feu (piège
// de Fefnir) n'a d'ailleurs pas de vraie place sur Olympia : on n'y entre que
// par le Volcan, sa position déclarée est un placeholder sur Eryn Dolen.
const HIDDEN_PLANS = new Set(['zanadun_s2', 'piege_de_fefnir_s2']);

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const world = await prisma.plan.findUnique({
      where: { name: WORLD },
      select: {
        visibleBoundsMinX: true,
        visibleBoundsMaxX: true,
        visibleBoundsMinY: true,
        visibleBoundsMaxY: true,
      },
    });
    if (!world || world.visibleBoundsMinX == null || world.visibleBoundsMaxX == null ||
        world.visibleBoundsMinY == null || world.visibleBoundsMaxY == null) {
      return errorResponse('World bounds are not seeded', 500, origin);
    }
    const bounds = {
      minX: world.visibleBoundsMinX,
      maxX: world.visibleBoundsMaxX,
      minY: world.visibleBoundsMinY,
      maxY: world.visibleBoundsMaxY,
    };

    const [plans, portals] = await Promise.all([
      prisma.plan.findMany({
        // Les archives des saisons closes n'ont plus de place sur ce monde-ci.
        where: {
          name: { not: WORLD },
          worldX: { not: null },
          worldY: { not: null },
          OR: [{ season: null }, { season: CURRENT_SEASON }],
        },
        select: { name: true, displayName: true, worldX: true, worldY: true, visibleByDefault: true },
        orderBy: { displayName: 'asc' },
      }),
      prisma.planPortal.findMany({ where: { plan: WORLD, z: 0 }, select: { x: true, y: true, toPlan: true } }),
    ]);

    // L'entrée réelle vaut mieux que la position déclarée du plan (le manoir
    // est déclaré sur Zagnadar, son passage est à vingt cases de là) : quand
    // des téléporteurs d'Olympia mènent au plan, on se place à leur centre.
    const entrance = new Map<string, { sx: number; sy: number; n: number }>();
    for (const portal of portals) {
      const e = entrance.get(portal.toPlan) ?? { sx: 0, sy: 0, n: 0 };
      e.sx += portal.x;
      e.sy += portal.y;
      e.n++;
      entrance.set(portal.toPlan, e);
    }

    // Un lieu par nom affiché (la faille et sa sous-faille ne font qu'un),
    // placé à son entrée quand on la connaît, sinon où le plan se déclare.
    const byName = new Map<string, { x: number; y: number; fromEntrance: boolean; plans: string[]; visibleByDefault: boolean }>();
    for (const p of plans) {
      if (HIDDEN_PLANS.has(p.name)) continue;
      const e = entrance.get(p.name);
      const x = e ? Math.round(e.sx / e.n) : (p.worldX as number);
      const y = e ? Math.round(e.sy / e.n) : (p.worldY as number);
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
      // (0,0) est la valeur par défaut des plans jamais placés ; seul un lieu
      // que le jeu affiche lui-même a le droit d'y être (la taverne).
      if (x === 0 && y === 0 && !p.visibleByDefault) continue;
      const current = byName.get(p.displayName);
      if (!current) {
        byName.set(p.displayName, { x, y, fromEntrance: !!e, plans: [p.name], visibleByDefault: p.visibleByDefault });
        continue;
      }
      current.plans.push(p.name);
      current.visibleByDefault ||= p.visibleByDefault;
      if (e && !current.fromEntrance) Object.assign(current, { x, y, fromEntrance: true });
    }

    const byCell = new Map<string, { x: number; y: number; names: string[]; plans: string[]; visibleByDefault: boolean }>();
    for (const [displayName, place] of byName) {
      const key = `${place.x},${place.y}`;
      if (!byCell.has(key)) byCell.set(key, { x: place.x, y: place.y, names: [], plans: [], visibleByDefault: false });
      const cell = byCell.get(key)!;
      cell.names.push(displayName);
      cell.plans.push(...place.plans);
      cell.visibleByDefault ||= place.visibleByDefault;
    }
    const markers = Array.from(byCell.values()).map((c) => ({ ...c, label: c.names.join(' / ') }));
    return jsonResponse({ world: WORLD, bounds, markers }, { origin });
  } catch (err) {
    logger.error('World markers failed:', err);
    return errorResponse(err instanceof Error ? err.message : 'Internal error', 500, origin);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
