import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonResponse, errorResponse, preflight, parseTargetId } from '@/lib/api';
import { getCallerContext, canAccessTargetId, type CallerContext } from '@/lib/authContext';
import { readableTopicIds, resolveActors, cleanText } from '@/lib/questAccess';
import { isQuestStatus } from '@/lib/questStatus';

/** Une quête appartient au carnet d'un personnage : mêmes droits que ce personnage. */
async function loadOwnedQuest(ctx: CallerContext, questId: number) {
  const quest = await prisma.quest.findUnique({
    where: { id: questId },
    select: { id: true, character: { select: { id: true, targetId: true, name: true } } },
  });
  if (!quest) return { ok: false as const, error: 'Quête introuvable', status: 404 };
  if (!canAccessTargetId(ctx, quest.character.targetId)) {
    return { ok: false as const, error: 'Forbidden', status: 403 };
  }
  return { ok: true as const, quest };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const { id } = await context.params;
    const questId = parseTargetId(id);
    if (questId === null) return errorResponse('Identifiant de quête invalide', 400, origin);

    const owned = await loadOwnedQuest(ctx, questId);
    if (!owned.ok) return errorResponse(owned.error, owned.status, origin);

    const body = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const title = cleanText(body.title, 200);
      if (!title) return errorResponse('Le titre ne peut pas être vide', 400, origin);
      data.title = title;
    }
    for (const field of ['summary', 'stake', 'nextStep'] as const) {
      if (body[field] !== undefined) data[field] = cleanText(body[field]);
    }
    if (body.status !== undefined) {
      if (!isQuestStatus(body.status)) return errorResponse('Statut inconnu', 400, origin);
      data.status = body.status;
    }

    // `topicIds` et `actors` sont des remplacements complets : le client envoie
    // la liste telle qu'elle doit être après l'édition.
    let unknownActors: string[] = [];
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.quest.update({ where: { id: questId }, data });
      } else {
        // Touche updatedAt pour que le carnet remonte la quête éditée.
        await tx.quest.update({ where: { id: questId }, data: { updatedAt: new Date() } });
      }

      if (Array.isArray(body.topicIds)) {
        const topicIds = await readableTopicIds(
          ctx,
          body.topicIds.map((raw: unknown) => parseInt(String(raw), 10))
        );
        await tx.questTopic.deleteMany({ where: { questId } });
        if (topicIds.length > 0) {
          await tx.questTopic.createMany({
            data: topicIds.map((topicId) => ({ questId, topicId })),
          });
        }
      }

      if (Array.isArray(body.actors)) {
        const actors = await resolveActors(body.actors);
        unknownActors = actors.unknown;
        await tx.questActor.deleteMany({ where: { questId } });
        if (actors.rows.length > 0) {
          await tx.questActor.createMany({
            data: actors.rows.map((row) => ({ questId, ...row })),
          });
        }
      }
    });

    logger.info(`Quest ${questId} updated (${Object.keys(data).join(', ') || 'liens'})`);
    return jsonResponse({ id: questId, unknownActors }, { origin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error updating quest: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const { id } = await context.params;
    const questId = parseTargetId(id);
    if (questId === null) return errorResponse('Identifiant de quête invalide', 400, origin);

    const owned = await loadOwnedQuest(ctx, questId);
    if (!owned.ok) return errorResponse(owned.error, owned.status, origin);

    // Les liens partent en cascade (cf. migration) ; les fils, eux, sont intacts.
    await prisma.quest.delete({ where: { id: questId } });
    logger.info(`Quest ${questId} deleted`);
    return jsonResponse({ id: questId, deleted: true }, { origin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error deleting quest: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
