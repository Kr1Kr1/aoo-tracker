// Le corpus qui contextualise une missive neuve.
//
// Ouvrir un fil, ce n'est pas y répondre : il n'y a aucune conversation à
// relire au-dessus du champ de saisie. Ce qui en tient lieu, c'est ce qui s'est
// déjà écrit ailleurs, et deux gisements suffisent :
//
// 1. la correspondance avec le destinataire. Elle dit la relation (tutoiement
//    ou vouvoiement, surnoms, ce qui reste en suspens entre eux) et c'est la
//    seule chose qu'aucun profil ne peut deviner ;
// 2. les missives voisines : celles dont le titre recoupe le sujet annoncé, ou
//    qui réunissent les personnes nommées. Elles disent comment ce genre de
//    lettre s'ouvre et se clôt chez ce personnage, sans lui faire emprunter le
//    ton d'une relation qui n'a rien à voir.
//
// Tout ce qui sort d'ici est passé par la règle de visibilité de
// lib/authContext : une missive qu'on n'a pas le droit de lire n'entre pas dans
// un prompt.

import prisma from '@/lib/prisma';
import { visibleMissiveTopicIds, type CallerContext } from '@/lib/authContext';
import { htmlToPlainText } from '@/lib/ai/draftReplies';
import { messageTime, sortMessagesChronologically } from '@/lib/messageDate';
import { foldName } from '@/lib/questMotifs';
import { tokenize } from '@/lib/questSearch';

const DAY_MS = 86_400_000;

/** Plafonds : le dossier part chez un modèle, il doit rester lisible. */
const RECIPIENT_THREADS = 4;
const RELATED_THREADS = 3;
const EXCERPTS_PER_THREAD = 3;
const EXCERPT_CHARS = 700;
/** En dessous, le rapprochement ne tient qu'à un mot passe-partout du titre. */
const MIN_RELATED_SCORE = 1.5;
/** Un fil oublié depuis trois mois n'apprend plus rien d'une relation vivante. */
const RECENT_DAYS = 90;
/**
 * Au-delà, ce n'est plus une correspondance mais un salon : le jeu envoie des
 * missives à dix-huit personnes, et un fil pareil n'apprend rien de la relation
 * entre deux d'entre elles. On ne l'écarte pas (il porte parfois le sujet), on
 * le fait passer derrière le moindre tête-à-tête.
 */
const SALON_PARTICIPANTS = 6;

export type CorpusExcerpt = { author: string; date: string; text: string };

export type CorpusThread = {
  topicId: number;
  name: string;
  lastLabel: string;
  silentDays: number | null;
  participants: string[];
  /** Ce qui a fait retenir ce fil, à afficher tel quel dans l'interface. */
  reason: string;
  excerpts: CorpusExcerpt[];
};

export type MissiveCorpus = {
  /** Destinataires retrouvés en base, sous leur orthographe canonique. */
  recipients: string[];
  /** Destinataires demandés dont aucune missive ne porte la trace. */
  unknownRecipients: string[];
  withRecipient: CorpusThread[];
  related: CorpusThread[];
  scannedTopics: number;
};

type TopicMeta = {
  id: number;
  name: string;
  lastAt: number;
  participants: string[];
  participantKeys: Set<string>;
  messageCount: number;
};

/**
 * Un fil de missive est identifié par son titre : la base garde des copies d'un
 * même fil (cf. la normalisation des liens dans /api/forums), et deux copies
 * dans un prompt, c'est une place perdue et une redite.
 */
function dedupeByName(threads: TopicMeta[]): TopicMeta[] {
  const kept = new Map<string, TopicMeta>();
  for (const thread of threads) {
    const key = foldName(thread.name);
    const previous = kept.get(key);
    if (!previous || thread.lastAt > previous.lastAt) kept.set(key, thread);
  }
  return [...kept.values()];
}

/** Poids des termes du sujet et de l'intention : un nom propre discrimine mieux. */
function buildSubjectQuery(text: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const token of new Set(tokenize(text))) weights.set(token, 1);
  for (const match of text.matchAll(/\p{Lu}[\p{L}'’-]{2,}/gu)) {
    const folded = foldName(match[0]);
    if (weights.has(folded)) weights.set(folded, 1.5);
  }
  return weights;
}

export async function gatherMissiveCorpus(opts: {
  ctx: CallerContext;
  /** Le personnage qui écrit : ses propres noms ne servent pas de rapprochement. */
  speakerName: string;
  recipients: string[];
  subject?: string | null;
  intent?: string | null;
}): Promise<MissiveCorpus> {
  const speakerKey = foldName(opts.speakerName);
  const recipientKeys = new Set(
    opts.recipients.map((name) => foldName(name)).filter((key) => key.length > 0)
  );

  const visible = await visibleMissiveTopicIds(opts.ctx);
  const topics = await prisma.topics.findMany({
    where: {
      forum: { type: 'Missives' },
      ...(visible === null ? {} : { id: { in: visible } }),
    },
    select: {
      id: true,
      name: true,
      messages: {
        select: {
          id: true,
          date: true,
          createdAt: true,
          character: { select: { name: true } },
        },
      },
    },
  });

  const metas: TopicMeta[] = topics.map((topic) => {
    const ordered = sortMessagesChronologically(topic.messages);
    const last = ordered[ordered.length - 1];
    const names = new Map<string, string>();
    for (const message of topic.messages) {
      names.set(foldName(message.character.name), message.character.name);
    }
    return {
      id: topic.id,
      name: topic.name,
      lastAt: last ? messageTime(last) : 0,
      participants: [...names.values()],
      participantKeys: new Set(names.keys()),
      messageCount: ordered.length,
    };
  });

  const canonical = dedupeByName(metas).filter((meta) => meta.messageCount > 0);

  // Les personnes qui comptent pour un rapprochement : les destinataires, plus
  // celles que l'auteur nomme dans son sujet ou son intention. On ne les devine
  // pas, on les reconnaît : seul un nom déjà vu dans une missive est retenu.
  const brief = `${opts.subject ?? ''} ${opts.intent ?? ''}`.trim();
  const briefFolded = foldName(brief);
  const peopleKeys = new Set(recipientKeys);
  for (const meta of canonical) {
    for (const key of meta.participantKeys) {
      if (key === speakerKey || key.length < 3) continue;
      if (briefFolded.includes(key)) peopleKeys.add(key);
    }
  }

  const now = Date.now();

  // Ce qui fait une correspondance utile, dans l'ordre : peu de monde autour
  // (un tête-à-tête dit la relation, un salon dit le sujet), le personnage y a
  // écrit lui-même, et c'est récent. La récence seule remontait les fils de
  // dix-huit participants, où rien ne se joue entre deux personnes.
  const withRecipientAll = canonical
    .filter((meta) => [...recipientKeys].some((key) => meta.participantKeys.has(key)))
    .map((meta) => {
      const size = meta.participants.length;
      const speakerPresent = meta.participantKeys.has(speakerKey);
      let score = size <= 2 ? 4 : size <= 3 ? 3 : size <= SALON_PARTICIPANTS ? 1.5 : 0;
      if (speakerPresent) score += 2;
      const days = meta.lastAt ? (now - meta.lastAt) / DAY_MS : Number.POSITIVE_INFINITY;
      if (days <= RECENT_DAYS) score += 2;
      else if (days <= 365) score += 1;
      return { meta, score, speakerPresent, intimate: size <= SALON_PARTICIPANTS };
    })
    .sort((a, b) => b.score - a.score || b.meta.lastAt - a.meta.lastAt);
  const withRecipient = withRecipientAll.slice(0, RECIPIENT_THREADS);
  const alreadyTaken = new Set(withRecipient.map((row) => row.meta.id));

  // Rapprochement par titre : un terme rare (« Memestra ») vaut mieux qu'un
  // terme que tous les titres portent (« conseil »), d'où l'idf sur les titres.
  const query = buildSubjectQuery(brief);
  const documentFrequency = new Map<string, number>();
  const titleTokens = new Map<number, Set<string>>();
  for (const meta of canonical) {
    const tokens = new Set(tokenize(meta.name));
    titleTokens.set(meta.id, tokens);
    for (const token of tokens) {
      if (!query.has(token)) continue;
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const total = canonical.length || 1;

  const related = canonical
    .filter((meta) => !alreadyTaken.has(meta.id))
    .map((meta) => {
      let score = 0;
      for (const token of titleTokens.get(meta.id) ?? []) {
        const weight = query.get(token);
        if (!weight) continue;
        score += weight * Math.log(1 + total / (1 + (documentFrequency.get(token) ?? 0)));
      }
      // Les mêmes personnes autour de la table : c'est le second critère, à
      // part égale avec le titre, et le seul qui vaille quand le sujet est neuf.
      const shared = [...meta.participantKeys].filter(
        (key) => key !== speakerKey && peopleKeys.has(key)
      );
      score += 2 * shared.length;
      if (meta.lastAt && (now - meta.lastAt) / DAY_MS <= RECENT_DAYS) score += 0.5;
      // Un salon reste du contexte de sujet, mais un fil resserré en dit plus
      // par ligne : à note égale, il passe devant.
      if (meta.participants.length > SALON_PARTICIPANTS) score *= 0.7;
      return { meta, score, shared };
    })
    .filter((row) => row.score >= MIN_RELATED_SCORE)
    .sort((a, b) => b.score - a.score || b.meta.lastAt - a.meta.lastAt)
    .slice(0, RELATED_THREADS);

  const chosenIds = [...withRecipient.map((r) => r.meta.id), ...related.map((r) => r.meta.id)];
  const contents = chosenIds.length
    ? await prisma.messages.findMany({
        where: { topicId: { in: chosenIds } },
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

  const byTopic = new Map<number, typeof contents>();
  for (const message of contents) {
    const bucket = byTopic.get(message.topicId);
    if (bucket) bucket.push(message);
    else byTopic.set(message.topicId, [message]);
  }

  const excerptsOf = (topicId: number, pick: 'last' | 'edges'): CorpusExcerpt[] => {
    const ordered = sortMessagesChronologically(byTopic.get(topicId) ?? []);
    // Avec le destinataire, ce sont les derniers messages qui portent la
    // relation et ce qui reste en suspens. Dans une missive voisine, c'est son
    // ouverture qu'on vient chercher : comment ce personnage entame une lettre
    // sur ce sujet, et comment il la clôt.
    let picked =
      pick === 'last'
        ? ordered.slice(-EXCERPTS_PER_THREAD)
        : [ordered[0], ordered[ordered.length - 1]].filter(Boolean);

    // Un fil à trois s'achève parfois sur un aparté qui ne concerne pas le
    // destinataire : la tranche ne contiendrait alors pas une ligne de sa main,
    // et c'est justement sa plume qu'on vient chercher. On lui garde une place.
    if (
      pick === 'last' &&
      recipientKeys.size > 0 &&
      !picked.some((message) => recipientKeys.has(foldName(message.character.name)))
    ) {
      const lastFromRecipient = [...ordered]
        .reverse()
        .find((message) => recipientKeys.has(foldName(message.character.name)));
      if (lastFromRecipient) {
        picked = sortMessagesChronologically([lastFromRecipient, ...picked.slice(1)]);
      }
    }
    const seen = new Set<number>();
    const excerpts: CorpusExcerpt[] = [];
    for (const message of picked) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      excerpts.push({
        author: message.character.name,
        date: message.date,
        text: htmlToPlainText(message.content).slice(0, EXCERPT_CHARS),
      });
    }
    return excerpts;
  };

  const describe = (meta: TopicMeta, reason: string, pick: 'last' | 'edges'): CorpusThread => ({
    topicId: meta.id,
    name: meta.name,
    lastLabel: meta.lastAt ? new Date(meta.lastAt).toLocaleDateString('fr-FR') : 'aucun message',
    silentDays: meta.lastAt ? Math.max(Math.floor((now - meta.lastAt) / DAY_MS), 0) : null,
    participants: meta.participants,
    reason,
    excerpts: excerptsOf(meta.id, pick),
  });

  // « medarda » tapé à la volée doit ressortir « Medarda » : le prompt nomme le
  // destinataire comme le jeu l'écrit, pas comme l'auteur l'a saisi.
  const canonicalNames = new Map<string, string>();
  for (const { meta } of withRecipientAll) {
    for (const name of meta.participants) {
      const key = foldName(name);
      if (recipientKeys.has(key)) canonicalNames.set(key, name);
    }
  }

  return {
    recipients: opts.recipients.map((name) => canonicalNames.get(foldName(name)) ?? name),
    unknownRecipients: opts.recipients.filter((name) => !canonicalNames.has(foldName(name))),
    withRecipient: withRecipient.map((row) =>
      describe(
        row.meta,
        // Dire d'où sort chaque fil : un salon et un tête-à-tête ne se lisent
        // pas pareil, et un fil où le personnage n'a jamais écrit ne prouve
        // aucun passé commun (il est visible parce qu'il est arrivé dans la
        // boîte du compte, cf. lib/authContext).
        !row.speakerPresent
          ? `missive lue par ${opts.speakerName} sans y avoir écrit : aucun passé commun prouvé`
          : row.intimate
            ? 'échange rapproché avec le destinataire'
            : `fil collectif (${row.meta.participants.length} participants) où le destinataire écrit`,
        'last'
      )
    ),
    related: related.map((row) =>
      describe(
        row.meta,
        row.shared.length
          ? `mêmes personnes impliquées (${row.shared.length}) et titre proche`
          : 'titre proche du sujet annoncé',
        'edges'
      )
    ),
    scannedTopics: canonical.length,
  };
}
