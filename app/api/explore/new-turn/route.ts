import { logger } from '@/lib/logger';
import {
  jsonResponse,
  errorResponse,
  preflight,
  isLocalEngineRequest,
  LOCAL_ENGINE_TARGET_IDS,
} from '@/lib/api';
import { getCallerContext, canAccessTargetId } from '@/lib/authContext';
import {
  localEngineSql,
  sqlLiteral,
  forgetLocalPlayerCache,
  localEngineErrorStatus,
} from '@/lib/localEngine';

// Renouveler le tour de l'arpenteuse sur le moteur local.
//
// Le moteur ne propose rien pour ça côté joueur (le report de tour ne va que
// vers l'avant), et la commande console `new_turn` demande un compte admin.
// On fait donc ce que la commande fait, directement dans sa base : ramener
// `nextTurnTime` à maintenant, puis jeter le cache joueur du moteur
// (`datas/private/players/<id>.json`, ce que fait `refresh_data()`), sans quoi
// index.php relirait l'ancienne heure. Le prochain chargement d'index.php rend
// alors le « Nouveau Tour » et restitue les mouvements. La route ne touche
// jamais qu'aux personas autorisées.
//
// Body : { ownerId: 232, playerName: "Medarda" }
// La persona est gatée sur son targetId canonique (celui que la carte accepte),
// mais la ligne locale se retrouve par son nom : les identifiants de
// l'instance locale ne sont pas garantis identiques à ceux du vrai jeu.

const NAME_RE = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' _-]{0,39}$/;

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    if (!isLocalEngineRequest(request)) {
      return errorResponse('Turn renewal is only for the local engine', 403, origin);
    }
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const body = await request.json();
    const ownerId = Number(body.ownerId);
    if (!LOCAL_ENGINE_TARGET_IDS.includes(ownerId)) {
      return errorResponse(`ownerId must be one of ${LOCAL_ENGINE_TARGET_IDS.join(', ')}`, 403, origin);
    }
    if (!canAccessTargetId(ctx, ownerId)) return errorResponse('Forbidden', 403, origin);

    const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : '';
    if (!NAME_RE.test(playerName)) return errorResponse('playerName is required', 400, origin);

    const [row] = await localEngineSql(
      `SELECT id, nextTurnTime FROM players WHERE LOWER(name) = LOWER(${sqlLiteral(playerName)}) LIMIT 1`
    );
    if (!row) return errorResponse(`No local player named "${playerName}"`, 404, origin);
    const [localId, previous] = row;

    await localEngineSql(
      `UPDATE players SET nextTurnTime = UNIX_TIMESTAMP(), nextTurnRescheduled = 0 WHERE id = ${Number(localId)}`
    );
    await forgetLocalPlayerCache(Number(localId));
    logger.info(
      `Local engine: new turn granted to ${playerName} (local id ${localId}, previous nextTurnTime ${previous})`
    );

    return jsonResponse({ ok: true, localId: Number(localId), previousNextTurnTime: Number(previous) }, { origin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Local engine new turn failed:', message);
    return errorResponse(`Renouvellement impossible : ${message}`, localEngineErrorStatus(message), origin);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
