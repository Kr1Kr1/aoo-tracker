// Le ton d'un personnage, appris de ses propres messages.
//
// Le profil écrit (lib/ai/profiles/<nom>.md) décrit une voix ; ces extraits
// *sont* la voix. Un profil vieillit, une plume dérive : ce que le personnage a
// écrit ces dernières semaines dit mieux son registre que ce qu'on a noté de lui
// il y a six mois. Sert aux brouillons de réponse comme aux missives de quête.

import prisma from '@/lib/prisma';
import { htmlToPlainText } from '@/lib/ai/draftReplies';
import { messageTime } from '@/lib/messageDate';

/** En dessous, c'est « ok », « merci » : rien à apprendre d'un ton. */
const MIN_SAMPLE_CHARS = 120;
const SCAN_LIMIT = 200;

export async function loadVoiceSamples(opts: {
  characterId: number;
  /**
   * Forum visé : on n'écrit pas une missive comme un RP. Les messages du même
   * forum passent devant, les autres complètent.
   */
  forumId?: number | null;
  excludeTopicId?: number | null;
  limit?: number;
  chars?: number;
}): Promise<string[]> {
  const limit = opts.limit ?? 6;
  const chars = opts.chars ?? 900;

  const rows = await prisma.messages.findMany({
    where: {
      characterId: opts.characterId,
      topic: { forum: { type: { not: 'HRP' } } },
      ...(opts.excludeTopicId ? { topicId: { not: opts.excludeTopicId } } : {}),
    },
    select: {
      content: true,
      date: true,
      createdAt: true,
      topic: { select: { forumId: true } },
    },
    orderBy: { id: 'desc' },
    take: SCAN_LIMIT,
  });

  const candidates = rows
    .map((row) => ({
      text: htmlToPlainText(row.content),
      sameForum: opts.forumId != null && row.topic.forumId === opts.forumId,
      at: messageTime(row),
    }))
    .filter((row) => row.text.length >= MIN_SAMPLE_CHARS)
    .sort((a, b) => Number(b.sameForum) - Number(a.sameForum) || b.at - a.at);

  const samples: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    // Deux messages qui ouvrent pareil ouvrent souvent pareil jusqu'au bout :
    // mieux vaut varier les exemples que répéter la même formule.
    const key = candidate.text.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(candidate.text.slice(0, chars));
    if (samples.length >= limit) break;
  }
  return samples;
}

/** Bloc de prompt : les extraits, présentés comme l'étalon du registre. */
export function renderVoiceSamples(characterName: string, samples: string[]): string {
  const usable = samples.filter((sample) => sample.trim().length > 40);
  if (usable.length === 0) return '';

  return `\n\n---\n\n# MESSAGES RÉELS DE ${characterName.toUpperCase()} (verbatim)

Calque la longueur, le débit et le niveau de langue de ces messages avant tout le reste. Ce qui ne se retrouve nulle part ici ni dans le profil n'a pas à apparaître dans ta production.

${usable.map((sample, index) => `## Exemple ${index + 1}\n${sample}`).join('\n\n')}`;
}
