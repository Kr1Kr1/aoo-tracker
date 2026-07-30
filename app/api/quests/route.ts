import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonResponse, errorResponse, preflight } from '@/lib/api';
import { getCallerContext } from '@/lib/authContext';
import {
  resolveQuestCharacter,
  readableTopicIds,
  readableMessageIds,
  resolveActors,
  cleanText,
} from '@/lib/questAccess';
import { listQuests } from '@/lib/quests';
import { isQuestStatus } from '@/lib/questStatus';

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const url = new URL(request.url);
    const resolution = await resolveQuestCharacter(ctx, url.searchParams.get('characterTargetId'));
    if (!resolution.ok) return errorResponse(resolution.error, resolution.status, origin);

    const quests = await listQuests(resolution.character.id);
    return jsonResponse({ character: resolution.character, quests }, { origin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error listing quests: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const body = await request.json().catch(() => ({}));
    const resolution = await resolveQuestCharacter(ctx, body.characterTargetId);
    if (!resolution.ok) return errorResponse(resolution.error, resolution.status, origin);

    const title = cleanText(body.title, 200);
    if (!title) return errorResponse('Un titre est requis', 400, origin);

    const status = isQuestStatus(body.status) ? body.status : 'lead';
    const origin_ = body.origin === 'ai' ? 'ai' : 'manual';

    const topicIds = Array.isArray(body.topicIds)
      ? await readableTopicIds(
          ctx,
          body.topicIds.map((id: unknown) => parseInt(String(id), 10))
        )
      : [];
    const actors = Array.isArray(body.actors) ? await resolveActors(body.actors) : { rows: [], unknown: [] };

    // La trace : les messages précis qui portent l'intrigue. Facultatifs, mais
    // c'est ce qui rend lisible une affaire étalée sur des mois.
    const messageIds = Array.isArray(body.messageIds)
      ? await readableMessageIds(
          ctx,
          body.messageIds.map((id: unknown) => parseInt(String(id), 10))
        )
      : [];

    const quest = await prisma.quest.create({
      data: {
        characterId: resolution.character.id,
        title,
        summary: cleanText(body.summary),
        stake: cleanText(body.stake),
        nextStep: cleanText(body.nextStep),
        status,
        origin: origin_,
        topics: { create: topicIds.map((topicId) => ({ topicId })) },
        anchors: { create: messageIds.map((messageId) => ({ messageId })) },
        actors: { create: actors.rows },
      },
      select: { id: true },
    });

    logger.info(
      `Quest ${quest.id} created for ${resolution.character.name} (${origin_}, ${topicIds.length} fil(s), ${messageIds.length} ancre(s))`
    );
    return jsonResponse(
      {
        id: quest.id,
        linkedTopics: topicIds.length,
        linkedMessages: messageIds.length,
        unknownActors: actors.unknown,
      },
      { status: 201, origin }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error creating quest: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
