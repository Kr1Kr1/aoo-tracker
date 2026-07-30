import prisma from '@/lib/prisma';
import { canAccessTargetId, visibleMissiveTopicIds, type CallerContext } from '@/lib/authContext';
import { resolveCharactersByName } from '@/lib/quests';

// Qui ouvre quel carnet. Un carnet appartient à un personnage : l'appelant doit
// pouvoir agir en son nom (personnage rattaché au compte, ou admin).

export type QuestCharacter = { id: number; targetId: number; name: string };

export type Resolution =
  | { ok: true; character: QuestCharacter }
  | { ok: false; error: string; status: number };

/**
 * Personnage visé : paramètre explicite, sinon le personnage joué en session
 * (acting-as), sinon le premier personnage rattaché au compte.
 */
export async function resolveQuestCharacter(
  ctx: CallerContext,
  rawTargetId?: string | number | null
): Promise<Resolution> {
  let targetId: number | null = null;

  if (rawTargetId !== undefined && rawTargetId !== null && rawTargetId !== '') {
    const parsed = parseInt(String(rawTargetId), 10);
    if (Number.isNaN(parsed)) return { ok: false, error: 'characterTargetId invalide', status: 400 };
    if (!canAccessTargetId(ctx, parsed)) {
      return { ok: false, error: 'Forbidden: personnage non rattaché à ce compte', status: 403 };
    }
    targetId = parsed;
  } else if (ctx.actingAsTargetId != null) {
    targetId = ctx.actingAsTargetId;
  } else if (ctx.characterTargetIds.length > 0) {
    targetId = ctx.characterTargetIds[0];
  }

  if (targetId === null) {
    return { ok: false, error: 'Aucun personnage rattaché à ce compte', status: 400 };
  }

  const character = await prisma.characters.findUnique({
    where: { targetId },
    select: { id: true, targetId: true, name: true },
  });
  if (!character) return { ok: false, error: 'Personnage introuvable', status: 404 };
  return { ok: true, character };
}

/**
 * Fils que l'appelant peut rattacher à une quête. On reprend la règle de
 * visibilité déjà appliquée par les pages forum : les fils RP et privés sont
 * lisibles par tout compte connecté, les missives selon la règle de
 * lib/authContext (ou tout, pour un admin). Une piste peut donc citer un fil où
 * le personnage n'a jamais écrit, ce qui est précisément l'intérêt.
 */
export async function readableTopicIds(ctx: CallerContext, topicIds: number[]): Promise<number[]> {
  const unique = [...new Set(topicIds)].filter((id) => Number.isInteger(id));
  if (unique.length === 0) return [];

  const existing = await prisma.topics.findMany({
    where: { id: { in: unique } },
    select: { id: true, forum: { select: { type: true } } },
  });
  if (ctx.role === 'admin') return existing.map((t) => t.id);

  const open = existing.filter((t) => t.forum.type !== 'Missives').map((t) => t.id);
  const missives = existing.filter((t) => t.forum.type === 'Missives').map((t) => t.id);
  if (missives.length === 0) return open;

  // Même règle que la boîte à missives : une missive reçue et jamais répondue
  // n'a aucun message de soi, elle reste pourtant la sienne.
  const visible = await visibleMissiveTopicIds(ctx, missives);
  return visible === null ? [...open, ...missives] : [...open, ...visible];
}

/**
 * Messages qu'une quête peut citer comme preuve : ceux dont le fil est déjà
 * lisible par l'appelant. Un ancrage ne doit pas devenir une porte dérobée vers
 * une missive à laquelle le compte n'a pas accès.
 */
export async function readableMessageIds(ctx: CallerContext, messageIds: number[]): Promise<number[]> {
  const unique = [...new Set(messageIds)].filter((id) => Number.isInteger(id));
  if (unique.length === 0) return [];

  const messages = await prisma.messages.findMany({
    where: { id: { in: unique } },
    select: { id: true, topicId: true },
  });
  const allowedTopics = new Set(await readableTopicIds(ctx, messages.map((m) => m.topicId)));
  return messages.filter((m) => allowedTopics.has(m.topicId)).map((m) => m.id);
}

export type ActorInput = { targetId?: number | string; name?: string; role?: string };

/**
 * Résout les acteurs d'une quête : par targetId quand on l'a, par nom sinon.
 * Les noms sans correspondance ressortent dans `unknown` : on préfère le dire
 * à l'auteur plutôt que de créer un personnage fantôme.
 */
export async function resolveActors(actors: ActorInput[]) {
  const byTargetId = actors
    .map((a) => (a.targetId != null ? parseInt(String(a.targetId), 10) : NaN))
    .filter((id) => !Number.isNaN(id));

  const namedOnly = actors.filter((a) => a.targetId == null && typeof a.name === 'string');
  const [known, resolved] = await Promise.all([
    prisma.characters.findMany({
      where: { targetId: { in: byTargetId } },
      select: { id: true, targetId: true, name: true },
    }),
    resolveCharactersByName(namedOnly.map((a) => a.name as string)),
  ]);

  const roleFor = new Map<string, string | null>();
  for (const actor of actors) {
    const key =
      actor.targetId != null ? `t:${actor.targetId}` : `n:${(actor.name || '').toLowerCase()}`;
    roleFor.set(
      key,
      typeof actor.role === 'string' && actor.role.trim() ? actor.role.trim().slice(0, 120) : null
    );
  }

  const rows = new Map<number, { characterId: number; role: string | null }>();
  for (const character of known) {
    rows.set(character.id, {
      characterId: character.id,
      role: roleFor.get(`t:${character.targetId}`) ?? null,
    });
  }
  for (const character of resolved.found) {
    if (rows.has(character.id)) continue;
    rows.set(character.id, {
      characterId: character.id,
      role: roleFor.get(`n:${character.name.toLowerCase()}`) ?? null,
    });
  }

  return { rows: [...rows.values()], unknown: resolved.unknown };
}

/** Champ texte d'une quête : trimé, plafonné, vide devient null. */
export function cleanText(value: unknown, max = 4000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
