import { logger } from '@/lib/logger';
import {
  jsonResponse,
  errorResponse,
  preflight,
  isLocalEngineRequest,
  LOCAL_ENGINE_TARGET_IDS,
} from '@/lib/api';
import { getCallerContext, canAccessTargetId } from '@/lib/authContext';
import prisma from '@/lib/prisma';
import { localEnginePortals, localEngineErrorStatus } from '@/lib/localEngine';

// Les passages d'un niveau de plan, pour l'arpentage automatique.
//
// Un téléporteur ne se voit pas sur la carte : l'arpenteuse ne peut ni les
// éviter tant que le plan n'est pas fini, ni les viser ensuite, sans qu'on
// les lui donne. On sert la copie importée (PlanPortal, cf. pnpm
// seed-portals) et, si elle manque pour ce plan, on lit la base du moteur
// local en direct.
//
// Body : { ownerId: 232, plan: "olympia", z: 0 }

const PLAN_RE = /^[a-z0-9_]{1,64}$/;

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    if (!isLocalEngineRequest(request)) {
      return errorResponse('Portals are only for the local engine', 403, origin);
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
    if (!PLAN_RE.test(plan)) return errorResponse('plan is required', 400, origin);

    const stored = await prisma.planPortal.findMany({
      where: { plan, z },
      select: { x: true, y: true, toPlan: true, toZ: true, toX: true, toY: true },
    });
    const portals =
      stored.length > 0
        ? stored.map((p) => ({ x: p.x, y: p.y, to: { plan: p.toPlan, z: p.toZ, x: p.toX, y: p.toY } }))
        : await localEnginePortals(plan, z);
    logger.info(`${portals.length} portal cell(s) on ${plan} z${z}${stored.length ? '' : ' (lus en direct)'}`);
    return jsonResponse({ plan, z, portals }, { origin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Local engine portals failed:', message);
    return errorResponse(`Passages illisibles : ${message}`, localEngineErrorStatus(message), origin);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
