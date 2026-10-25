import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  jsonResponse,
  errorResponse,
  preflight,
  isLocalEngineRequest,
  LOCAL_ENGINE_TARGET_IDS,
} from '@/lib/api';
import { getCallerContext, canAccessTargetId } from '@/lib/authContext';
import { nextExploreStep, type Point } from '@/lib/explore';

// Arpentage automatique du moteur local : d'où l'arpenteuse regarde, et où
// aller ensuite (voir lib/explore.ts). Réservé aux relevés du moteur local,
// et aux personas qui ont le droit d'y cartographier : cette route ne fait
// que lire la carte et noter un point d'observation.
//
// Body :
// {
//   ownerId: 232,
//   plan: "olympia", z: 0,          // clé de plan résolue par /api/maps
//   x: 7, y: -41,                    // position actuelle
//   radius: 6,                       // perception : rayon de la vue
//   blocked: [{ x, y }],             // cases infranchissables apprises en route
//   goal: [{ x, y }],                // optionnel : rejoindre la plus proche plutôt que découvrir
// }

function points(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && Number.isInteger(p.x) && Number.isInteger(p.y))
    .map((p) => ({ x: p.x, y: p.y }));
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    if (!isLocalEngineRequest(request)) {
      return errorResponse('Exploration is only for the local engine', 403, origin);
    }
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const body = await request.json();
    const ownerId = Number(body.ownerId);
    if (!LOCAL_ENGINE_TARGET_IDS.includes(ownerId)) {
      return errorResponse(`ownerId must be one of ${LOCAL_ENGINE_TARGET_IDS.join(', ')}`, 403, origin);
    }
    if (!canAccessTargetId(ctx, ownerId)) return errorResponse('Forbidden', 403, origin);

    const plan = typeof body.plan === 'string' ? body.plan.trim() : '';
    const z = Number.isInteger(body.z) ? body.z : 0;
    const x = Number(body.x);
    const y = Number(body.y);
    const radius = Number(body.radius);
    if (!plan || !Number.isInteger(x) || !Number.isInteger(y)) {
      return errorResponse('plan, x and y are required', 400, origin);
    }
    if (!Number.isInteger(radius) || radius < 1 || radius > 30) {
      return errorResponse('radius must be an integer between 1 and 30', 400, origin);
    }
    const known = await prisma.plan.findUnique({ where: { name: plan }, select: { name: true } });
    if (!known) return errorResponse(`Unknown plan "${plan}"`, 422, origin);

    // D'ici, avec cette perception, tout a été vu : le noter avant de chercher
    // où aller, sinon la position courante resterait une destination.
    await prisma.surveyPoint.upsert({
      where: { plan_z_x_y_radius: { plan, z, x, y, radius } },
      create: { plan, z, x, y, radius, ownerId },
      update: { at: new Date() },
    });

    const [cells, surveys] = await Promise.all([
      prisma.coords.findMany({
        where: { plan, z },
        select: { x: true, y: true, mapWalls: { select: { id: true }, take: 1 } },
      }),
      prisma.surveyPoint.findMany({
        where: { plan, z },
        select: { x: true, y: true, radius: true },
      }),
    ]);

    const knownCells = cells.map((c) => ({ x: c.x, y: c.y }));
    const walls = cells.filter((c) => c.mapWalls.length > 0).map((c) => ({ x: c.x, y: c.y }));
    const blocked = points(body.blocked);
    const goal = points(Array.isArray(body.goal) ? body.goal : [body.goal]);

    const started = Date.now();
    const result = nextExploreStep({
      from: { x, y },
      radius,
      known: knownCells,
      walls,
      surveys,
      blocked,
      goal: goal.length > 0 ? goal : undefined,
    });
    logger.info(
      `Explore ${plan} z${z} from ${x},${y} r${radius}${goal.length ? ` goal ×${goal.length}` : ''}: ` +
        (result.done
          ? `done (${result.reason})`
          : `step ${result.step.x},${result.step.y} -> ${result.target.x},${result.target.y} ` +
            `(${result.distance} pas, ${result.reveals} cases à voir)`) +
        ` [${cells.length} cases connues, ${surveys.length} points de vue, ${Date.now() - started} ms]`
    );

    return jsonResponse(
      { ...result, known: cells.length, surveys: surveys.length },
      { origin }
    );
  } catch (err) {
    logger.error('Explore next failed:', err);
    return errorResponse(err instanceof Error ? err.message : 'Internal error', 500, origin);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
