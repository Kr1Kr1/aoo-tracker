// Retrouver, dans tout ce qui s'est écrit, ce qui parle d'une quête.
//
// Une quête saisie à la main ne contient que ce que l'auteur a tapé : deux
// lignes, parfois un fil. Or l'histoire, elle, est éparpillée dans des mois de
// RP, de forums privés et de missives. Ce module fait le tri en amont du modèle
// (qui ne peut pas lire douze mille messages) : il traite la quête comme une
// requête, note chaque message sur ce qu'il en partage, et ne remonte que le
// dossier de preuves.
//
// La notation est un BM25 dégrossi : un terme rare (« Memestra ») pèse plus
// qu'un terme courant (« olympien »), et un message compte d'autant plus qu'il
// vient d'un fil déjà rattaché ou d'un personnage déjà cité.

import prisma from '@/lib/prisma';
import { visibleMissiveTopicIds, type CallerContext } from '@/lib/authContext';
import { htmlToPlainText } from '@/lib/ai/draftReplies';
import { messageTime, sortMessagesChronologically } from '@/lib/messageDate';
import { foldName } from '@/lib/questMotifs';
import { channelOfForumType, CHANNEL_LABEL, type QuestChannel } from '@/lib/questStatus';

/** Mots vides français : ils sont partout, ils ne discriminent rien. */
const STOPWORDS = new Set([
  'avec', 'sans', 'pour', 'dans', 'chez', 'vers', 'sous', 'entre', 'depuis', 'pendant',
  'avant', 'apres', 'aussi', 'alors', 'ainsi', 'comme', 'donc', 'mais', 'plus', 'moins',
  'tout', 'tous', 'toute', 'toutes', 'meme', 'encore', 'toujours', 'jamais', 'rien',
  'cette', 'celui', 'celle', 'leur', 'leurs', 'notre', 'votre', 'elle', 'elles',
  'nous', 'vous', 'ils', 'lui', 'que', 'qui', 'quoi', 'dont', 'est', 'sont', 'etait',
  'etaient', 'ete', 'avoir', 'etre', 'fait', 'faire', 'dit', 'dire', 'peut', 'pouvoir',
  'veut', 'vouloir', 'doit', 'devoir', 'bien', 'tres', 'trop', 'peu', 'beaucoup',
  'quete', 'quelque', 'quelques', 'chose', 'personne', 'moment', 'temps', 'jour',
  'fois', 'facon', 'maniere', 'suite', 'part', 'point', 'coup', 'cote', 'lors',
]);

const WORD = /[\p{L}][\p{L}'’-]{2,}/gu;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(WORD)) {
    const folded = foldName(match[0]);
    if (folded.length < 4 || STOPWORDS.has(folded)) continue;
    tokens.push(folded);
  }
  return tokens;
}

export type EvidenceMessage = {
  messageId: number;
  author: string;
  date: string;
  at: number;
  score: number;
  text: string;
};

export type EvidenceThread = {
  topicId: number;
  name: string;
  channel: QuestChannel;
  channelLabel: string;
  messageCount: number;
  /** Le fil est déjà au carnet pour cette quête. */
  linked: boolean;
  participants: string[];
  score: number;
  messages: EvidenceMessage[];
};

export type QuestQuery = {
  /** Les termes cherchés, du plus discriminant au moins. */
  terms: string[];
  threads: EvidenceThread[];
  scanned: { messages: number; topics: number };
};

// Plafonds : le dossier part chez un modèle, il doit rester lisible et tenir
// dans le temps imparti à la route.
const MAX_QUERY_TERMS = 24;
const MAX_THREADS = 12;
const MAX_MESSAGES_PER_THREAD = 4;
const EXCERPT_CHARS = 700;
/** En dessous, le message ne partage qu'un mot passe-partout avec la quête. */
const MIN_SCORE = 2;

/**
 * Termes à chercher, tirés de la quête elle-même : son titre, son résumé, son
 * enjeu, les noms de ses acteurs et de ses fils. Les noms propres comptent
 * double : ce sont eux qui identifient une histoire.
 */
export function buildQuestQuery(parts: {
  title: string;
  summary?: string | null;
  stake?: string | null;
  nextStep?: string | null;
  actorNames?: string[];
  topicNames?: string[];
}): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (text: string | null | undefined, weight: number) => {
    if (!text) return;
    for (const token of new Set(tokenize(text))) {
      weights.set(token, Math.max(weights.get(token) ?? 0, weight));
    }
    // Un nom propre reste un nom propre : capitalisé dans le texte d'origine.
    for (const match of text.matchAll(/\p{Lu}[\p{L}'’-]{2,}/gu)) {
      const folded = foldName(match[0]);
      if (folded.length >= 4 && !STOPWORDS.has(folded)) {
        weights.set(folded, Math.max(weights.get(folded) ?? 0, weight * 1.5));
      }
    }
  };

  add(parts.title, 2);
  add(parts.summary, 1);
  add(parts.stake, 1);
  add(parts.nextStep, 1);
  for (const name of parts.actorNames ?? []) add(name, 3);
  for (const name of parts.topicNames ?? []) add(name, 1.5);

  return new Map([...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_QUERY_TERMS));
}

/**
 * Fils lisibles par l'appelant : on reprend la règle des pages forum. Les fils
 * RP, publics et privés sont ouverts à tout compte connecté ; pour les missives,
 * c'est lib/authContext qui tranche (une reçue sans réponse reste la sienne).
 * Un scan ne doit pas devenir une fenêtre sur la correspondance des autres.
 */
async function readableTopicScope(ctx: CallerContext) {
  const topics = await prisma.topics.findMany({
    select: { id: true, name: true, forumId: true, forum: { select: { type: true } } },
  });

  const missives = topics.filter((t) => t.forum.type === 'Missives').map((t) => t.id);
  if (missives.length === 0) return topics;

  const visible = await visibleMissiveTopicIds(ctx, missives);
  if (visible === null) return topics;

  const allowed = new Set(visible);
  return topics.filter((t) => t.forum.type !== 'Missives' || allowed.has(t.id));
}

/**
 * Relit tout ce que l'appelant a le droit de lire et remonte les fils qui
 * parlent de cette quête, leurs meilleurs passages d'abord. Les fils HRP sont
 * écartés : ils parlent des joueurs, pas de l'histoire.
 */
export async function gatherQuestEvidence(opts: {
  query: Map<string, number>;
  linkedTopicIds: number[];
  actorNames: string[];
  /** Le personnage dont c'est le carnet : ses propres messages comptent un peu plus. */
  characterId: number;
  ctx: CallerContext;
}): Promise<QuestQuery> {
  const terms = [...opts.query.keys()];
  const linked = new Set(opts.linkedTopicIds);
  const actorSet = new Set(opts.actorNames.map(foldName));

  const scope = (await readableTopicScope(opts.ctx)).filter((t) => t.forum.type !== 'HRP');

  const topicById = new Map(scope.map((t) => [t.id, t]));
  if (topicById.size === 0 || terms.length === 0) {
    return { terms, threads: [], scanned: { messages: 0, topics: 0 } };
  }

  const messages = await prisma.messages.findMany({
    where: { topicId: { in: [...topicById.keys()] } },
    select: {
      id: true,
      topicId: true,
      content: true,
      date: true,
      createdAt: true,
      characterId: true,
      character: { select: { name: true } },
    },
  });

  // Passe 1 : où chaque terme apparaît, pour savoir lesquels sont rares.
  const plain = new Map<number, string>();
  const hits = new Map<number, Map<string, number>>();
  const documentFrequency = new Map<string, number>();

  for (const message of messages) {
    const text = htmlToPlainText(message.content);
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;

    const counts = new Map<string, number>();
    for (const token of tokens) {
      if (!opts.query.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    if (counts.size === 0) continue;

    plain.set(message.id, text);
    hits.set(message.id, counts);
    for (const token of counts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const total = messages.length || 1;
  const idf = new Map(
    terms.map((term) => [term, Math.log(1 + total / (1 + (documentFrequency.get(term) ?? 0)))])
  );

  // Passe 2 : la note d'un message, et celle du fil qui le porte.
  const scored = new Map<number, number>();
  for (const message of messages) {
    const counts = hits.get(message.id);
    if (!counts) continue;

    let score = 0;
    for (const [term, count] of counts) {
      // Saturation : dix occurrences du même mot ne valent pas dix fois une.
      score += (opts.query.get(term) ?? 1) * (idf.get(term) ?? 1) * (1 + Math.log(count));
    }
    if (linked.has(message.topicId)) score *= 1.3;
    if (actorSet.has(foldName(message.character.name))) score *= 1.2;
    if (message.characterId === opts.characterId) score *= 1.1;
    if (score >= MIN_SCORE) scored.set(message.id, score);
  }

  const byTopic = new Map<number, typeof messages>();
  for (const message of messages) {
    if (!scored.has(message.id)) continue;
    const bucket = byTopic.get(message.topicId);
    if (bucket) bucket.push(message);
    else byTopic.set(message.topicId, [message]);
  }

  const threads: EvidenceThread[] = [];
  for (const [topicId, bucket] of byTopic) {
    const topic = topicById.get(topicId)!;
    // La note d'un fil est celle de ses meilleurs passages, pas la somme de
    // tout : un fil de cinq cents messages gagnerait sinon d'office.
    const ranked = [...bucket].sort((a, b) => (scored.get(b.id) ?? 0) - (scored.get(a.id) ?? 0));
    const best = ranked.slice(0, MAX_MESSAGES_PER_THREAD);
    const score = best.reduce((sum, m) => sum + (scored.get(m.id) ?? 0), 0);

    threads.push({
      topicId,
      name: topic.name,
      channel: channelOfForumType(topic.forum.type),
      channelLabel: CHANNEL_LABEL[channelOfForumType(topic.forum.type)],
      messageCount: bucket.length,
      linked: linked.has(topicId),
      participants: [...new Set(bucket.map((m) => m.character.name))],
      score,
      messages: sortMessagesChronologically(best).map((m) => ({
        messageId: m.id,
        author: m.character.name,
        date: m.date,
        at: messageTime(m),
        score: Math.round((scored.get(m.id) ?? 0) * 10) / 10,
        text: (plain.get(m.id) ?? '').slice(0, EXCERPT_CHARS),
      })),
    });
  }

  threads.sort((a, b) => Number(b.linked) - Number(a.linked) || b.score - a.score);

  // La base garde des copies d'un même fil (cf. la normalisation des liens dans
  // /api/forums) : sans ça le dossier remonte deux fois la même conversation et
  // gâche des places. On garde la copie la mieux notée.
  const canonical = new Map<string, EvidenceThread>();
  for (const thread of threads) {
    const key = foldName(thread.name);
    const kept = canonical.get(key);
    if (!kept || thread.score > kept.score) canonical.set(key, thread);
  }

  return {
    terms,
    threads: [...canonical.values()].slice(0, MAX_THREADS),
    scanned: { messages: messages.length, topics: topicById.size },
  };
}
