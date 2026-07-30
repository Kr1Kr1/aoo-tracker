import { logger } from '@/lib/logger';
import { jsonResponse, errorResponse, preflight } from '@/lib/api';
import { getCallerContext } from '@/lib/authContext';
import { resolveQuestCharacter, readableTopicIds } from '@/lib/questAccess';
import { linkableTopics, resolveCharactersByName } from '@/lib/quests';
import { composeQuestFromText } from '@/lib/ai/questCompose';

// Comme /api/drafts et /api/quests/detect : le CLI Claude local prend son temps.
export const maxDuration = 300;

/**
 * Une quête dictée en clair, rendue au client sous forme de brouillon de
 * formulaire. Rien n'est écrit en base ici : l'auteur relit, corrige, puis
 * enregistre par POST /api/quests.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const body = await request.json().catch(() => ({}));
    const resolution = await resolveQuestCharacter(ctx, body.characterTargetId);
    if (!resolution.ok) return errorResponse(resolution.error, resolution.status, origin);
    const character = resolution.character;

    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
    if (text.length < 10) {
      return errorResponse('Décrivez la quête en quelques mots au moins', 400, origin);
    }

    const topics = await linkableTopics(character.id);
    const composed = await composeQuestFromText({ characterName: character.name, text, topics });

    // Mêmes garde-fous que la détection : le modèle ne rattache que des fils
    // lisibles par l'appelant et ne nomme que des personnages connus de la base.
    const allowed = new Map(topics.map((t) => [t.topicId, t]));
    const topicIds = await readableTopicIds(
      ctx,
      [...new Set(composed.topicIds ?? [])].filter((id) => allowed.has(id))
    );
    const { found, unknown } = await resolveCharactersByName(composed.actors ?? []);
    const actors = found.filter((c) => c.id !== character.id);

    logger.info(
      `Quest composed for ${character.name}: « ${composed.title} » (${topicIds.length} fil(s), ${actors.length} acteur(s))`
    );
    return jsonResponse(
      {
        character,
        draft: {
          title: composed.title,
          summary: composed.summary,
          stake: composed.stake,
          nextStep: composed.nextStep,
          status: composed.status,
          topicIds,
          topics: topicIds.map((id) => {
            const topic = allowed.get(id)!;
            return { topicId: id, name: topic.name, channel: topic.channel, involved: topic.involved };
          }),
          actors: actors.map((c) => ({ targetId: c.targetId, name: c.name })),
        },
        unknownActors: unknown,
      },
      { origin }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error composing quest: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
