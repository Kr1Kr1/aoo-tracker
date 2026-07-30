import prisma from '@/lib/prisma';
import { messageTime, sortMessagesChronologically } from '@/lib/messageDate';
import { htmlToPlainText } from '@/lib/ai/draftReplies';
import {
  CHANNEL_LABEL,
  channelOfForumType,
  isQuestStatus,
  type QuestChannel,
  type QuestTopicView,
  type QuestView,
} from '@/lib/questStatus';

// Le carnet de quêtes d'un personnage : les intrigues encore ouvertes, ce qui
// s'y joue pour lui, et ce qu'il lui reste à faire. Une quête n'est jamais
// scrapée : elle est saisie à la main ou proposée par la détection IA puis
// validée. Ce module fournit (1) la lecture du carnet, (2) le dossier de fils
// en suspens que la détection donne à lire au modèle.

export { CHANNEL_LABEL, channelOfForumType };

const DAY_MS = 86_400_000;

function formatDay(ms: number): string {
  if (!ms) return 'jamais';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Métadonnées d'activité des fils demandés. `Topics.updatedAt` suit l'heure de
 * scrape et pas celle du fil : comme ailleurs dans le tracker, la fraîcheur se
 * recalcule sur les dates de messages (cf. lib/messageDate).
 */
async function topicActivity(topicIds: number[], mineCharacterId: number) {
  const result = new Map<number, Omit<QuestTopicView, 'note'>>();
  if (topicIds.length === 0) return result;

  const [topics, messages, forums] = await Promise.all([
    prisma.topics.findMany({
      where: { id: { in: topicIds } },
      select: { id: true, name: true, link: true, closed: true, forumId: true },
    }),
    prisma.messages.findMany({
      where: { topicId: { in: topicIds } },
      select: { id: true, topicId: true, date: true, createdAt: true, characterId: true },
    }),
    prisma.forums.findMany({ select: { id: true, type: true } }),
  ]);

  const forumType = new Map(forums.map((f) => [f.id, f.type]));
  const byTopic = new Map<number, typeof messages>();
  for (const message of messages) {
    const bucket = byTopic.get(message.topicId);
    if (bucket) bucket.push(message);
    else byTopic.set(message.topicId, [message]);
  }

  const lastByTopic = new Map<number, { characterId: number; at: number; count: number }>();
  for (const [topicId, bucket] of byTopic) {
    const sorted = sortMessagesChronologically(bucket);
    const last = sorted[sorted.length - 1];
    lastByTopic.set(topicId, {
      characterId: last.characterId,
      at: messageTime(last),
      count: sorted.length,
    });
  }

  const authors = await prisma.characters.findMany({
    where: { id: { in: [...new Set([...lastByTopic.values()].map((l) => l.characterId))] } },
    select: { id: true, name: true },
  });
  const authorName = new Map(authors.map((a) => [a.id, a.name]));

  for (const topic of topics) {
    const last = lastByTopic.get(topic.id);
    result.set(topic.id, {
      topicId: topic.id,
      name: topic.name,
      link: topic.link,
      channel: channelOfForumType(forumType.get(topic.forumId)),
      closed: topic.closed,
      messageCount: last?.count ?? 0,
      lastAuthor: last ? authorName.get(last.characterId) ?? '?' : 'aucun message',
      lastAt: last?.at ?? 0,
      lastLabel: formatDay(last?.at ?? 0),
      lastIsMine: last ? last.characterId === mineCharacterId : false,
    });
  }
  return result;
}

export async function listQuests(characterId: number): Promise<QuestView[]> {
  const quests = await prisma.quest.findMany({
    where: { characterId },
    include: {
      topics: { select: { topicId: true, note: true } },
      actors: {
        include: {
          character: { select: { targetId: true, name: true, faction: { select: { name: true } } } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const topicIds = [...new Set(quests.flatMap((q) => q.topics.map((t) => t.topicId)))];
  const activity = await topicActivity(topicIds, characterId);
  const now = Date.now();

  return quests.map((quest) => {
    const topics = quest.topics
      .map((link) => {
        const meta = activity.get(link.topicId);
        return meta ? { ...meta, note: link.note } : null;
      })
      .filter((t): t is QuestTopicView => t !== null)
      .sort((a, b) => b.lastAt - a.lastAt);

    const lastAt = topics.reduce((max, t) => Math.max(max, t.lastAt), 0);

    return {
      id: quest.id,
      title: quest.title,
      summary: quest.summary,
      stake: quest.stake,
      nextStep: quest.nextStep,
      status: isQuestStatus(quest.status) ? quest.status : 'lead',
      origin: quest.origin,
      createdAt: quest.createdAt.getTime(),
      topics,
      actors: quest.actors.map((a) => ({
        targetId: a.character.targetId,
        name: a.character.name,
        faction: a.character.faction?.name ?? 'Sans faction',
        role: a.role,
      })),
      lastAt,
      lastLabel: formatDay(lastAt),
      staleDays: lastAt ? Math.floor((now - lastAt) / DAY_MS) : null,
    };
  });
}

export type LinkableTopic = {
  topicId: number;
  name: string;
  channel: QuestChannel;
  lastLabel: string;
  /** Le personnage a écrit dans ce fil. */
  involved: boolean;
};

/**
 * Fils rattachables à la main : ceux où le personnage a écrit, plus des fils RP
 * ou privés récents où il n'est pas encore entré (une piste se rattache souvent
 * à une histoire qu'il ne fait qu'observer). Les plus frais d'abord.
 */
export async function linkableTopics(characterId: number, mineLimit = 120, aroundLimit = 60) {
  const mineTopicIds = (
    await prisma.messages.findMany({
      where: { characterId },
      select: { topicId: true },
      distinct: ['topicId'],
    })
  ).map((m) => m.topicId);

  const around = await prisma.topics.findMany({
    where: {
      id: { notIn: mineTopicIds },
      closed: false,
      forum: { type: { in: ['RP', 'Private'] } },
    },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take: aroundLimit,
  });

  const mineSet = new Set(mineTopicIds);
  const activity = await topicActivity([...mineTopicIds, ...around.map((t) => t.id)], characterId);

  const toOption = (t: Omit<QuestTopicView, 'note'>): LinkableTopic => ({
    topicId: t.topicId,
    name: t.name,
    channel: t.channel,
    lastLabel: t.lastLabel,
    involved: mineSet.has(t.topicId),
  });

  const all = [...activity.values()].sort((a, b) => b.lastAt - a.lastAt);
  return [
    ...all.filter((t) => mineSet.has(t.topicId)).slice(0, mineLimit).map(toOption),
    ...all.filter((t) => !mineSet.has(t.topicId)).slice(0, aroundLimit).map(toOption),
  ];
}

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

/**
 * Résout des noms de personnages (tels qu'écrits dans les fils, ou proposés par
 * la détection) en personnages de la base. Ce qui ne correspond à personne est
 * rendu tel quel plutôt qu'inventé : la quête ne rattache que du connu.
 */
export async function resolveCharactersByName(names: string[]) {
  const found: { id: number; targetId: number; name: string }[] = [];
  const unknown: string[] = [];
  if (names.length === 0) return { found, unknown };

  const all = await prisma.characters.findMany({ select: { id: true, targetId: true, name: true } });
  const byName = new Map(all.map((c) => [normalizeName(c.name), c]));

  for (const raw of names) {
    const match = byName.get(normalizeName(raw));
    if (!match) unknown.push(raw);
    else if (!found.some((f) => f.id === match.id)) found.push(match);
  }
  return { found, unknown };
}

// ─── Dossier de détection ─────────────────────────────────────────────

export type CandidateThread = {
  topicId: number;
  name: string;
  channel: QuestChannel;
  /** Le personnage a écrit dans ce fil (sinon : intrigue observée de l'extérieur). */
  involved: boolean;
  participants: string[];
  messageCount: number;
  lastLabel: string;
  silentDays: number;
  excerpts: { author: string; date: string; text: string }[];
};

export type DetectionDossier = {
  character: { id: number; targetId: number; name: string };
  threads: CandidateThread[];
};

// Le dossier part chez un modèle : il est plafonné pour rester lisible et tenir
// dans une fenêtre raisonnable. Les fils où le personnage a écrit pèsent plus
// lourd que ceux qu'il ne fait qu'observer.
const MINE_LIMIT = 20;
const AROUND_LIMIT = 10;
const EXCERPTS_PER_THREAD = 4;
const EXCERPT_CHARS = 700;
/** Au-delà, le fil relève de l'archive plutôt que de l'intrigue en cours. */
const MAX_SILENT_DAYS = 120;

/**
 * Rassemble les fils encore ouverts susceptibles de porter une intrigue non
 * résolue : ceux où le personnage a écrit, plus quelques fils RP récents où il
 * n'est pas encore entré (là où il « pourrait vouloir s'impliquer »). Les fils
 * déjà rattachés à une quête, clôturés ou HRP sont écartés.
 */
export async function buildDetectionDossier(characterId: number): Promise<DetectionDossier | null> {
  const character = await prisma.characters.findUnique({
    where: { id: characterId },
    select: { id: true, targetId: true, name: true },
  });
  if (!character) return null;

  const alreadyLinked = new Set(
    (
      await prisma.questTopic.findMany({
        where: { quest: { characterId } },
        select: { topicId: true },
      })
    ).map((t) => t.topicId)
  );

  const mineTopicIds = (
    await prisma.messages.findMany({
      where: { characterId },
      select: { topicId: true },
      distinct: ['topicId'],
    })
  ).map((m) => m.topicId);

  const forums = await prisma.forums.findMany({ select: { id: true, type: true } });
  const openForumIds = forums.filter((f) => f.type !== 'HRP').map((f) => f.id);

  // Les fils du personnage, plus un vivier de fils RP récents où il n'est pas.
  // `updatedAt` (heure de scrape) ne sert qu'à dégrossir ce vivier ; le tri
  // final se fait sur les vraies dates de messages.
  const [mineTopics, aroundTopics] = await Promise.all([
    prisma.topics.findMany({
      where: { id: { in: mineTopicIds }, closed: false, forumId: { in: openForumIds } },
      select: { id: true, name: true, forumId: true },
    }),
    prisma.topics.findMany({
      where: {
        id: { notIn: mineTopicIds },
        closed: false,
        forum: { type: { in: ['RP', 'Private'] } },
      },
      select: { id: true, name: true, forumId: true },
      orderBy: { updatedAt: 'desc' },
      take: AROUND_LIMIT * 6,
    }),
  ]);

  const pool = [
    ...mineTopics.map((t) => ({ ...t, involved: true })),
    ...aroundTopics.map((t) => ({ ...t, involved: false })),
  ].filter((t) => !alreadyLinked.has(t.id));
  if (pool.length === 0) return { character, threads: [] };

  const messages = await prisma.messages.findMany({
    where: { topicId: { in: pool.map((t) => t.id) } },
    select: {
      id: true,
      topicId: true,
      content: true,
      date: true,
      createdAt: true,
      character: { select: { name: true } },
    },
  });

  const byTopic = new Map<number, typeof messages>();
  for (const message of messages) {
    const bucket = byTopic.get(message.topicId);
    if (bucket) bucket.push(message);
    else byTopic.set(message.topicId, [message]);
  }

  const forumType = new Map(forums.map((f) => [f.id, f.type]));
  const now = Date.now();

  const threads: CandidateThread[] = [];
  for (const topic of pool) {
    const bucket = sortMessagesChronologically(byTopic.get(topic.id) ?? []);
    const last = bucket[bucket.length - 1];
    if (!last) continue;
    const silentDays = Math.floor((now - messageTime(last)) / DAY_MS);
    if (silentDays > MAX_SILENT_DAYS) continue;

    threads.push({
      topicId: topic.id,
      name: topic.name,
      channel: channelOfForumType(forumType.get(topic.forumId)),
      involved: topic.involved,
      participants: [...new Set(bucket.map((m) => m.character.name))],
      messageCount: bucket.length,
      lastLabel: formatDay(messageTime(last)),
      silentDays: Math.max(silentDays, 0),
      excerpts: bucket.slice(-EXCERPTS_PER_THREAD).map((m) => ({
        author: m.character.name,
        date: m.date,
        text: htmlToPlainText(m.content).slice(0, EXCERPT_CHARS),
      })),
    });
  }

  threads.sort((a, b) => a.silentDays - b.silentDays);
  const mine = threads.filter((t) => t.involved).slice(0, MINE_LIMIT);
  const around = threads.filter((t) => !t.involved).slice(0, AROUND_LIMIT);

  return { character, threads: [...mine, ...around] };
}
