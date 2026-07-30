import prisma from '@/lib/prisma';
import { messageTime, sortMessagesChronologically } from '@/lib/messageDate';
import { htmlToPlainText } from '@/lib/ai/draftReplies';
import { countTermMentions, extractRecurringMotifs, type RecurringMotif } from '@/lib/questMotifs';
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
  /** Auteur du dernier message : dit dans quel camp est la balle. */
  lastAuthor: string;
  lastIsMine: boolean;
  excerpts: { author: string; date: string; text: string }[];
};

/**
 * Fil citable par le modèle sans être détaillé dans le dossier : il porte un
 * fil rouge, mais son contenu se lit dans les citations du motif.
 */
export type CitableTopic = Pick<
  CandidateThread,
  'topicId' | 'name' | 'channel' | 'involved' | 'silentDays'
>;

export type DetectionDossier = {
  character: { id: number; targetId: number; name: string };
  threads: CandidateThread[];
  /** Ce qui revient sous sa plume au fil des mois (cf. lib/questMotifs). */
  motifs: RecurringMotif[];
  /** Fils cités par les motifs et absents du dossier détaillé. */
  motifTopics: CitableTopic[];
};

// Le dossier part chez un modèle : il est plafonné pour rester lisible et tenir
// dans une fenêtre raisonnable. Les fils où le personnage a écrit pèsent plus
// lourd que ceux qu'il ne fait qu'observer.
// Le dossier tient dans une fenêtre de contexte, mais surtout dans le temps
// imparti à la route (cf. maxDuration) : à 100 000 caractères la détection
// frôlait les cinq minutes. Les fils rouges valent mieux que des extraits plus
// longs, à budget égal.
const MINE_LIMIT = 16;
const AROUND_LIMIT = 8;
const EXCERPTS_PER_THREAD = 4;
const EXCERPT_CHARS = 550;
/** Au-delà, un fil ne compte plus comme « en cours » : il faut une raison de le rouvrir. */
const MAX_SILENT_DAYS = 120;
/**
 * Fils dormants repêchés parce qu'un fil rouge y passe. C'est là que se cachent
 * les poursuites longues : quand Medarda cherche Zeus depuis huit mois, un seul
 * de ses fils sur le sujet est encore frais, les autres dorment.
 */
const DORMANT_LIMIT = 8;
const DORMANT_MAX_SILENT_DAYS = 400;
const MOTIF_LIMIT = 8;

/**
 * Ce que le personnage a écrit, tous fils et toutes époques confondus (hors
 * HRP), et ce que le reste du forum a écrit à côté. Le premier lot donne les
 * fils rouges, le second sert d'étalon : un nom que tout le monde emploie est
 * du décor, pas une intrigue.
 */
async function readRecurringMotifs(characterId: number, characterName: string, covered: string[]) {
  const [ownMessages, otherMessages, knownCharacters] = await Promise.all([
    prisma.messages.findMany({
      where: { characterId, topic: { forum: { type: { not: 'HRP' } } } },
      select: {
        topicId: true,
        content: true,
        date: true,
        createdAt: true,
        topic: { select: { name: true } },
      },
    }),
    prisma.messages.findMany({
      where: { characterId: { not: characterId }, topic: { forum: { type: { not: 'HRP' } } } },
      select: { content: true },
    }),
    prisma.characters.findMany({ select: { name: true } }),
  ]);

  return extractRecurringMotifs({
    messages: ownMessages.map((m) => ({
      topicId: m.topicId,
      topicName: m.topic.name,
      at: messageTime(m),
      text: htmlToPlainText(m.content),
    })),
    knownNames: knownCharacters.map((c) => c.name),
    ownName: characterName,
    covered,
    background: {
      counts: countTermMentions(otherMessages.map((m) => htmlToPlainText(m.content))),
      total: otherMessages.length,
    },
    limit: MOTIF_LIMIT,
  });
}

/**
 * Rassemble les fils encore ouverts susceptibles de porter une intrigue non
 * résolue : ceux où le personnage a écrit, plus quelques fils RP récents où il
 * n'est pas encore entré (là où il « pourrait vouloir s'impliquer »). Les fils
 * déjà rattachés à une quête, clôturés ou HRP sont écartés.
 *
 * S'y ajoute la lecture au long cours : les fils rouges, et les fils dormants
 * qu'ils désignent. Un dossier de fils frais ne montre que le présent ; une
 * intrigue peut avoir huit mois et rester ouverte.
 */
export async function buildDetectionDossier(characterId: number): Promise<DetectionDossier | null> {
  const character = await prisma.characters.findUnique({
    where: { id: characterId },
    select: { id: true, targetId: true, name: true },
  });
  if (!character) return null;

  const existingQuests = await prisma.quest.findMany({
    where: { characterId },
    select: { title: true, summary: true, topics: { select: { topicId: true } } },
  });
  const alreadyLinked = new Set(existingQuests.flatMap((q) => q.topics.map((t) => t.topicId)));

  // Les fils rouges se lisent sur tout l'historique, pas sur le vivier de fils
  // ouverts : ils servent ensuite à choisir quels fils dormants rouvrir.
  const motifs = await readRecurringMotifs(
    characterId,
    character.name,
    existingQuests.flatMap((q) => [q.title, q.summary ?? ''])
  );
  const motifTopicIds = new Set(motifs.flatMap((m) => m.topicIds));

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
  if (pool.length === 0) return { character, threads: [], motifs, motifTopics: [] };

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
    const silentDays = Math.max(Math.floor((now - messageTime(last)) / DAY_MS), 0);

    // Passé le délai, un fil ne revient au dossier que si un fil rouge y passe.
    const dormant = silentDays > MAX_SILENT_DAYS;
    if (dormant && !(topic.involved && motifTopicIds.has(topic.id))) continue;
    if (silentDays > DORMANT_MAX_SILENT_DAYS) continue;

    // L'amorce du fil dit ce qui a été demandé ou promis ; la fin dit où ça en
    // est resté. Ne garder que la fin, c'est lire une intrigue par son silence.
    const opening = bucket.length > EXCERPTS_PER_THREAD ? [bucket[0]] : [];
    const closing = bucket.slice(-(EXCERPTS_PER_THREAD - opening.length));

    threads.push({
      topicId: topic.id,
      name: topic.name,
      channel: channelOfForumType(forumType.get(topic.forumId)),
      involved: topic.involved,
      participants: [...new Set(bucket.map((m) => m.character.name))],
      messageCount: bucket.length,
      lastLabel: formatDay(messageTime(last)),
      silentDays,
      lastAuthor: last.character.name,
      lastIsMine: last.character.name === character.name,
      excerpts: [...opening, ...closing].map((m) => {
        const text = htmlToPlainText(m.content);
        return {
          author: m.character.name,
          date: m.date,
          // La coupure est signalée : sans marque, un long message coupé se lit
          // comme une phrase laissée en suspens, et le modèle en fait un mystère.
          text:
            text.length > EXCERPT_CHARS
              ? `${text.slice(0, EXCERPT_CHARS)} […extrait coupé ici, le message continue…]`
              : text,
        };
      }),
    });
  }

  // Le forum a servi le même fil sous deux liens (cf. la normalisation dans
  // /api/forums) : la base en garde des copies, que le modèle citerait comme
  // deux fils distincts. On ne garde que la copie la mieux fournie.
  const canonical = new Map<string, CandidateThread>();
  for (const thread of threads) {
    const key = normalizeName(thread.name);
    const kept = canonical.get(key);
    if (!kept || thread.messageCount > kept.messageCount) canonical.set(key, thread);
  }
  const deduped = [...canonical.values()];

  deduped.sort((a, b) => a.silentDays - b.silentDays);
  const fresh = deduped.filter((t) => t.silentDays <= MAX_SILENT_DAYS);
  const mine = fresh.filter((t) => t.involved).slice(0, MINE_LIMIT);
  const around = fresh.filter((t) => !t.involved).slice(0, AROUND_LIMIT);
  // Un dormant vaut d'être rouvert pour le fil rouge qui le traverse, pas pour
  // sa longueur : les fils de coordination sont les plus bavards et les moins
  // romanesques. On classe donc sur le meilleur motif qui le cite.
  const motifRank = new Map<number, number>();
  motifs.forEach((motif, index) => {
    for (const topicId of motif.topicIds) {
      motifRank.set(topicId, Math.min(motifRank.get(topicId) ?? index, index));
    }
  });
  const dormant = deduped
    .filter((t) => t.silentDays > MAX_SILENT_DAYS)
    .sort(
      (a, b) =>
        (motifRank.get(a.topicId) ?? motifs.length) - (motifRank.get(b.topicId) ?? motifs.length) ||
        b.messageCount - a.messageCount
    )
    .slice(0, DORMANT_LIMIT);

  const detailed = [...mine, ...around, ...dormant];
  const detailedIds = new Set(detailed.map((t) => t.topicId));
  const keptNames = new Set(detailed.map((t) => normalizeName(t.name)));

  // Les autres fils que citent les motifs restent citables : leur contenu se lit
  // dans les citations du fil rouge, on ne redonne que leur identité.
  const missing = [...motifTopicIds].filter((id) => !detailedIds.has(id) && !alreadyLinked.has(id));
  const motifTopics: CitableTopic[] = [];
  if (missing.length > 0) {
    const extra = await prisma.topics.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true, forumId: true },
    });
    const extraActivity = await topicActivity(
      extra.map((t) => t.id),
      characterId
    );
    for (const topic of extra) {
      // Même règle que plus haut : un fil déjà présent sous un autre identifiant
      // (copie, ou version détaillée du dossier) n'est pas proposé deux fois.
      const key = normalizeName(topic.name);
      if (keptNames.has(key)) continue;
      keptNames.add(key);

      const meta = extraActivity.get(topic.id);
      motifTopics.push({
        topicId: topic.id,
        name: topic.name,
        channel: channelOfForumType(forumType.get(topic.forumId)),
        involved: true,
        silentDays: meta?.lastAt ? Math.max(Math.floor((now - meta.lastAt) / DAY_MS), 0) : 0,
      });
    }
  }

  return { character, threads: detailed, motifs, motifTopics };
}
