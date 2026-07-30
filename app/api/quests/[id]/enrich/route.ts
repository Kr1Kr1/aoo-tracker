import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonResponse, errorResponse, preflight, parseTargetId } from '@/lib/api';
import { getCallerContext, canAccessTargetId } from '@/lib/authContext';
import { buildQuestQuery, gatherQuestEvidence } from '@/lib/questSearch';
import { resolveCharactersByName } from '@/lib/quests';
import { enrichQuestFromEvidence } from '@/lib/ai/questEnrich';

// Relecture du corpus puis passage chez le modèle : c'est la route la plus
// longue du carnet.
export const maxDuration = 300;

/**
 * Relit tous les échanges lisibles à la recherche de cette quête, et rend une
 * fiche enrichie. Rien n'est écrit : l'auteur applique par PATCH s'il veut.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const { id } = await context.params;
    const questId = parseTargetId(id);
    if (questId === null) return errorResponse('Identifiant de quête invalide', 400, origin);

    const quest = await prisma.quest.findUnique({
      where: { id: questId },
      include: {
        character: { select: { id: true, targetId: true, name: true } },
        actors: { include: { character: { select: { name: true } } } },
        topics: { include: { topic: { select: { id: true, name: true } } } },
        anchors: { select: { messageId: true } },
      },
    });
    if (!quest) return errorResponse('Quête introuvable', 404, origin);
    if (!canAccessTargetId(ctx, quest.character.targetId)) {
      return errorResponse('Forbidden', 403, origin);
    }

    const body = await request.json().catch(() => ({}));
    const instructions =
      typeof body.instructions === 'string' && body.instructions.trim()
        ? body.instructions.trim().slice(0, 2000)
        : undefined;

    const actorNames = quest.actors.map((a) => a.character.name);
    const topicNames = quest.topics.map((t) => t.topic.name);

    const query = buildQuestQuery({
      title: quest.title,
      summary: quest.summary,
      stake: quest.stake,
      nextStep: quest.nextStep,
      actorNames,
      topicNames,
    });

    const evidence = await gatherQuestEvidence({
      query,
      linkedTopicIds: quest.topics.map((t) => t.topic.id),
      actorNames,
      characterId: quest.character.id,
      ctx,
    });

    if (evidence.threads.length === 0) {
      return jsonResponse(
        {
          quest: { id: questId, title: quest.title },
          proposal: null,
          scanned: evidence.scanned,
          terms: evidence.terms,
        },
        { origin }
      );
    }

    const enriched = await enrichQuestFromEvidence({
      characterName: quest.character.name,
      quest: {
        title: quest.title,
        summary: quest.summary,
        stake: quest.stake,
        nextStep: quest.nextStep,
        status: quest.status,
        actors: quest.actors.map((a) => ({ name: a.character.name, role: a.role })),
        linkedTopicNames: topicNames,
      },
      threads: evidence.threads,
      terms: evidence.terms,
      instructions,
    });

    // Mêmes garde-fous qu'ailleurs : le modèle ne cite que ce qu'on lui a montré,
    // et ne nomme que des personnages connus de la base.
    const shownTopics = new Map(evidence.threads.map((t) => [t.topicId, t]));
    const shownMessages = new Map(
      evidence.threads.flatMap((t) => t.messages.map((m) => [m.messageId, t] as const))
    );

    const topicIds = [...new Set(enriched.topicIds ?? [])].filter((id) => shownTopics.has(id));
    const messageIds = [...new Set(enriched.messageIds ?? [])].filter((id) => shownMessages.has(id));

    const { found, unknown } = await resolveCharactersByName((enriched.actors ?? []).map((a) => a.name));
    const roleByName = new Map(
      (enriched.actors ?? []).map((a) => [a.name.toLowerCase(), a.role?.slice(0, 120) ?? ''])
    );
    const actors = found
      .filter((c) => c.id !== quest.character.id)
      .map((c) => ({ targetId: c.targetId, name: c.name, role: roleByName.get(c.name.toLowerCase()) ?? '' }));

    const alreadyLinked = new Set(quest.topics.map((t) => t.topic.id));
    const alreadyAnchored = new Set(quest.anchors.map((a) => a.messageId));

    logger.info(
      `Quest ${questId} enriched (${quest.character.name}): ${evidence.scanned.messages} message(s) relus, ` +
        `${evidence.threads.length} fil(s) retenus, ${topicIds.length} rattaché(s), ${messageIds.length} ancre(s)`
    );
    return jsonResponse(
      {
        quest: { id: questId, title: quest.title },
        scanned: evidence.scanned,
        terms: evidence.terms,
        proposal: {
          summary: enriched.summary,
          stake: enriched.stake,
          nextStep: enriched.nextStep,
          status: enriched.status,
          findings: enriched.findings ?? [],
          topicIds,
          messageIds,
          actors,
          topics: topicIds.map((id) => {
            const thread = shownTopics.get(id)!;
            return {
              topicId: id,
              name: thread.name,
              channel: thread.channel,
              isNew: !alreadyLinked.has(id),
            };
          }),
          anchors: messageIds.map((id) => {
            const thread = shownMessages.get(id)!;
            const message = thread.messages.find((m) => m.messageId === id)!;
            return {
              messageId: id,
              topicName: thread.name,
              author: message.author,
              date: message.date,
              excerpt: message.text.slice(0, 220),
              isNew: !alreadyAnchored.has(id),
            };
          }),
          unknownActors: unknown,
        },
      },
      { origin }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error enriching quest: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
