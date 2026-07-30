// Vocabulaire des quêtes : statuts, canaux, types de vue. Aucun accès base ici,
// pour que les composants client puissent l'importer sans embarquer Prisma.

export const QUEST_STATUSES = ['lead', 'engaged', 'waiting', 'closed', 'dismissed'] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export const QUEST_STATUS_LABEL: Record<QuestStatus, string> = {
  lead: '🧭 Piste',
  engaged: '🔥 Engagée',
  waiting: '⏳ En attente',
  closed: '✅ Résolue',
  dismissed: '🚫 Écartée',
};

export const QUEST_STATUS_HINT: Record<QuestStatus, string> = {
  lead: "L'intrigue existe, le personnage n'y est pas encore entré",
  engaged: 'Le personnage est impliqué et la balle est dans son camp',
  waiting: "En attente d'un tiers : réponse, événement, occasion",
  closed: 'Dénouée, gardée pour mémoire',
  dismissed: 'Volontairement laissée de côté',
};

export const QUEST_STATUS_COLOR: Record<QuestStatus, string> = {
  lead: 'bg-sky-100 text-sky-800',
  engaged: 'bg-orange-100 text-orange-800',
  waiting: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-emerald-100 text-emerald-800',
  dismissed: 'bg-gray-200 text-gray-700',
};

/** Statuts d'une quête encore vivante, dans l'ordre où le carnet les affiche. */
export const OPEN_STATUSES: QuestStatus[] = ['engaged', 'waiting', 'lead'];

export function isQuestStatus(value: unknown): value is QuestStatus {
  return typeof value === 'string' && (QUEST_STATUSES as readonly string[]).includes(value);
}

export type QuestChannel = 'missives' | 'prive' | 'rp' | 'hrp';

export const CHANNEL_LABEL: Record<QuestChannel, string> = {
  missives: 'Missive',
  prive: 'Forum privé',
  rp: 'RP',
  hrp: 'HRP',
};

export function channelOfForumType(type: string | null | undefined): QuestChannel {
  if (type === 'Missives') return 'missives';
  if (type === 'HRP') return 'hrp';
  if (type === 'Private') return 'prive';
  return 'rp';
}

export type QuestTopicView = {
  topicId: number;
  name: string;
  link: string;
  channel: QuestChannel;
  closed: boolean;
  messageCount: number;
  lastAuthor: string;
  lastAt: number;
  lastLabel: string;
  /** Le dernier message est du personnage : la balle est dans le camp d'en face. */
  lastIsMine: boolean;
  note: string | null;
};

export type QuestActorView = {
  targetId: number;
  name: string;
  faction: string;
  role: string | null;
};

export type QuestView = {
  id: number;
  title: string;
  summary: string | null;
  stake: string | null;
  nextStep: string | null;
  status: QuestStatus;
  origin: string;
  createdAt: number;
  topics: QuestTopicView[];
  actors: QuestActorView[];
  /** Dernier message de l'un des fils rattachés, 0 si aucun fil. */
  lastAt: number;
  lastLabel: string;
  /** Jours depuis ce dernier message, null si la quête n'a aucun fil. */
  staleDays: number | null;
};
