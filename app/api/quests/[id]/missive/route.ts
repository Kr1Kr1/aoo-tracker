import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonResponse, errorResponse, preflight, parseTargetId } from '@/lib/api';
import { getCallerContext, canAccessTargetId } from '@/lib/authContext';
import { loadVoiceProfile, htmlToPlainText } from '@/lib/ai/draftReplies';
import { loadVoiceSamples } from '@/lib/ai/voiceSamples';
import { generateQuestMissives, type QuestBrief } from '@/lib/ai/questMissive';
import { messageTime, sortMessagesChronologically } from '@/lib/messageDate';
import { CHANNEL_LABEL, channelOfForumType } from '@/lib/questStatus';

// Le CLI Claude local prend son temps, comme /api/drafts.
export const maxDuration = 300;

const DAY_MS = 86_400_000;
/** De quoi situer la conversation sans réécrire tout le fil dans le prompt. */
const EXCERPTS_PER_THREAD = 3;
const EXCERPT_CHARS = 900;
const THREADS_IN_BRIEF = 3;

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
        topics: {
          include: {
            topic: {
              select: {
                id: true,
                name: true,
                forumId: true,
                forum: { select: { type: true } },
              },
            },
          },
        },
      },
    });
    if (!quest) return errorResponse('Quête introuvable', 404, origin);
    if (!canAccessTargetId(ctx, quest.character.targetId)) {
      return errorResponse('Forbidden', 403, origin);
    }

    const body = await request.json().catch(() => ({}));
    const intent =
      typeof body.intent === 'string' && body.intent.trim() ? body.intent.trim().slice(0, 2000) : undefined;
    const recipient =
      typeof body.recipient === 'string' && body.recipient.trim()
        ? body.recipient.trim().slice(0, 120)
        : undefined;
    const count = Math.min(Math.max(parseInt(String(body.count ?? '2'), 10) || 2, 1), 4);

    // Les fils rattachés portent la conversation : ils disent à qui elle parle et
    // comment. On en prend les plus récents, leurs derniers messages seulement.
    const topicIds = quest.topics.map((link) => link.topic.id);
    const messages = topicIds.length
      ? await prisma.messages.findMany({
          where: { topicId: { in: topicIds } },
          select: {
            id: true,
            topicId: true,
            content: true,
            date: true,
            createdAt: true,
            character: { select: { name: true } },
          },
        })
      : [];

    const byTopic = new Map<number, typeof messages>();
    for (const message of messages) {
      const bucket = byTopic.get(message.topicId);
      if (bucket) bucket.push(message);
      else byTopic.set(message.topicId, [message]);
    }

    const now = Date.now();
    const threads = quest.topics
      .map((link) => {
        const bucket = sortMessagesChronologically(byTopic.get(link.topic.id) ?? []);
        const last = bucket[bucket.length - 1];
        const lastAt = last ? messageTime(last) : 0;
        return {
          forumId: link.topic.forumId,
          lastAt,
          brief: {
            name: link.topic.name,
            channel: CHANNEL_LABEL[channelOfForumType(link.topic.forum.type)],
            lastLabel: last
              ? new Date(lastAt).toLocaleDateString('fr-FR')
              : 'aucun message',
            silentDays: last ? Math.max(Math.floor((now - lastAt) / DAY_MS), 0) : null,
            excerpts: bucket.slice(-EXCERPTS_PER_THREAD).map((m) => ({
              author: m.character.name,
              date: m.date,
              text: htmlToPlainText(m.content).slice(0, EXCERPT_CHARS),
            })),
          },
        };
      })
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, THREADS_IN_BRIEF);

    // Le ton se prend d'abord dans le canal visé : une missive ne s'écrit pas
    // comme un RP. À défaut de fil rattaché, ses derniers messages suffisent.
    const missiveForumId =
      quest.topics.find((link) => link.topic.forum.type === 'Missives')?.topic.forumId ??
      threads[0]?.forumId ??
      null;

    const [profile, samples] = await Promise.all([
      loadVoiceProfile(quest.character.name),
      loadVoiceSamples({ characterId: quest.character.id, forumId: missiveForumId }),
    ]);

    const brief: QuestBrief = {
      title: quest.title,
      summary: quest.summary,
      stake: quest.stake,
      nextStep: quest.nextStep,
      status: quest.status,
      actors: quest.actors.map((a) => ({ name: a.character.name, role: a.role })),
      threads: threads.map((t) => t.brief),
    };

    const drafts = await generateQuestMissives({
      characterName: quest.character.name,
      profile,
      samples,
      quest: brief,
      intent,
      recipient,
      count,
    });

    logger.info(
      `Missive drafts for quest ${questId} (${quest.character.name}): ${drafts.length} draft(s), ${samples.length} voice sample(s)`
    );
    return jsonResponse(
      { character: quest.character.name, questTitle: quest.title, drafts, voiceSamples: samples.length },
      { origin }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error drafting quest missive: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
