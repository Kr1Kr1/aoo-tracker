import prisma from '@/lib/prisma';
import { messageTime } from '@/lib/messageDate';

// Builds the ego-network of one character: who they exchange with, how much,
// through which channel, and who among those contacts talk to each other.
//
// A note on `Characters.rank === "PNJ"`: it does NOT mean non-player. It is the
// placeholder rank given to a character the extension only ever saw mentioned by
// name, with no profile page scraped (they also get a negative `targetId`).
// Actual players sit in that bucket, so they are kept and merely flagged as
// "profil non résolu".

export type RelationContact = {
  targetId: number;
  name: string;
  faction: string;
  /** No profile ever scraped: synthetic targetId, rank forced to "PNJ". */
  unresolved: boolean;
  missives: number;
  forum: number;
  hrp: number;
  events: number;
  /** Epoch ms of the most recent exchange, 0 when unknown. */
  lastAt: number;
  lastLabel: string;
  lastChannel: string;
};

export type RelationPair = { a: number; b: number; weight: number };

export type RelationGraph = {
  center: { targetId: number; name: string; faction: string };
  contacts: RelationContact[];
  /** Links between two contacts, keyed by their index in `contacts`. */
  pairs: RelationPair[];
  topicCount: number;
  eventCount: number;
};

// Pairwise co-participation is only computed among the strongest contacts:
// past that the graph is unreadable anyway and the pair count grows squared.
const MAX_PAIRED_CONTACTS = 60;

const WITH_WHOM = /^(.*?)\s*\(mat\.(-?\d+)\)\s*$/;

function formatDay(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export async function buildRelationGraph(centerCharacterId: number): Promise<RelationGraph | null> {
  const center = await prisma.characters.findUnique({
    where: { id: centerCharacterId },
    select: { id: true, targetId: true, name: true, faction: { select: { name: true } } },
  });
  if (!center) return null;

  const centerTopics = await prisma.messages.findMany({
    where: { characterId: center.id },
    select: { topicId: true },
    distinct: ['topicId'],
  });
  const topicIds = centerTopics.map((t) => t.topicId);

  const [topics, forums, messages, rawEvents] = await Promise.all([
    prisma.topics.findMany({ where: { id: { in: topicIds } }, select: { id: true, forumId: true } }),
    prisma.forums.findMany({ select: { id: true, type: true } }),
    prisma.messages.findMany({
      where: { topicId: { in: topicIds } },
      select: { characterId: true, topicId: true, date: true, createdAt: true },
    }),
    prisma.events.findMany({
      where: { characterId: center.id },
      select: { event: true, date: true, calculatedDate: true, withWhom: true },
    }),
  ]);

  const forumType = new Map(forums.map((f) => [f.id, f.type]));
  const topicChannel = new Map<number, 'missives' | 'forum' | 'hrp'>();
  for (const topic of topics) {
    const type = forumType.get(topic.forumId);
    topicChannel.set(
      topic.id,
      type === 'Missives' ? 'missives' : type === 'HRP' ? 'hrp' : 'forum'
    );
  }

  type Accumulator = {
    missives: number;
    forum: number;
    hrp: number;
    events: number;
    lastAt: number;
    lastChannel: string;
  };
  const byCharacterId = new Map<number, Accumulator>();
  const blank = (): Accumulator => ({
    missives: 0,
    forum: 0,
    hrp: 0,
    events: 0,
    lastAt: 0,
    lastChannel: '',
  });

  const CHANNEL_LABEL = { missives: 'missive', forum: 'forum', hrp: 'HRP' } as const;

  // Forum side: every message someone else posted in a thread the center is in.
  const participantsByTopic = new Map<number, Set<number>>();
  for (const message of messages) {
    let participants = participantsByTopic.get(message.topicId);
    if (!participants) participantsByTopic.set(message.topicId, (participants = new Set()));
    participants.add(message.characterId);

    if (message.characterId === center.id) continue;
    const channel = topicChannel.get(message.topicId) || 'forum';
    const acc = byCharacterId.get(message.characterId) || blank();
    acc[channel] += 1;
    const at = messageTime(message);
    if (at > acc.lastAt) {
      acc.lastAt = at;
      acc.lastChannel = CHANNEL_LABEL[channel];
    }
    byCharacterId.set(message.characterId, acc);
  }

  // The whole roster: message authors are keyed by id, journal partners by
  // matricule, and the table is small enough that one read covers both.
  const characters = await prisma.characters.findMany({
    select: {
      id: true,
      targetId: true,
      name: true,
      rank: true,
      faction: { select: { name: true } },
    },
  });
  const byId = new Map(characters.map((c) => [c.id, c]));
  const byTargetId = new Map(characters.map((c) => [c.targetId, c]));

  // Journal side: `withWhom` names the other party, matricule included. The
  // extension re-ingests the same line several times, so dedupe first.
  const seenEvents = new Set<string>();
  let eventCount = 0;
  for (const event of rawEvents) {
    const withWhom = (event.withWhom || '').trim();
    if (!withWhom || withWhom === 'None') continue;
    const key = `${event.event}|${event.date}|${withWhom}`;
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);

    const match = withWhom.match(WITH_WHOM);
    const targetId = match ? parseInt(match[2], 10) : null;
    const partner = targetId !== null ? byTargetId.get(targetId) : null;
    if (!partner || partner.id === center.id) continue;

    eventCount += 1;
    const acc = byCharacterId.get(partner.id) || blank();
    acc.events += 1;
    const at = event.calculatedDate ? new Date(event.calculatedDate).getTime() : 0;
    if (at > acc.lastAt) {
      acc.lastAt = at;
      acc.lastChannel = 'jeu';
    }
    byCharacterId.set(partner.id, acc);
  }

  const contacts: (RelationContact & { characterId: number })[] = [];
  for (const [characterId, acc] of byCharacterId) {
    const character = byId.get(characterId);
    if (!character || characterId === center.id) continue;
    contacts.push({
      characterId,
      targetId: character.targetId,
      name: character.name,
      faction: character.faction?.name || 'Sans faction',
      unresolved: character.rank === 'PNJ',
      missives: acc.missives,
      forum: acc.forum,
      hrp: acc.hrp,
      events: acc.events,
      lastAt: acc.lastAt,
      lastLabel: formatDay(acc.lastAt),
      lastChannel: acc.lastChannel,
    });
  }

  const total = (c: RelationContact) => c.missives + c.forum + c.hrp + c.events;
  contacts.sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));

  // Neighbourhood: how many of the center's threads two contacts share.
  const indexByCharacterId = new Map<number, number>();
  contacts.slice(0, MAX_PAIRED_CONTACTS).forEach((c, i) => indexByCharacterId.set(c.characterId, i));

  const pairWeight = new Map<string, number>();
  for (const participants of participantsByTopic.values()) {
    const indexes = [...participants]
      .map((id) => indexByCharacterId.get(id))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b);
    for (let i = 0; i < indexes.length; i++) {
      for (let j = i + 1; j < indexes.length; j++) {
        const key = `${indexes[i]}:${indexes[j]}`;
        pairWeight.set(key, (pairWeight.get(key) || 0) + 1);
      }
    }
  }

  const pairs: RelationPair[] = [...pairWeight.entries()]
    .map(([key, weight]) => {
      const [a, b] = key.split(':').map(Number);
      return { a, b, weight };
    })
    .sort((x, y) => y.weight - x.weight);

  return {
    center: {
      targetId: center.targetId,
      name: center.name,
      faction: center.faction?.name || 'Sans faction',
    },
    contacts: contacts.map(({ characterId: _characterId, ...contact }) => contact),
    pairs,
    topicCount: topicIds.length,
    eventCount,
  };
}
