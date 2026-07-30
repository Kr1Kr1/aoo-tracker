import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonResponse, errorResponse, preflight } from '@/lib/api';
import { getCallerContext } from '@/lib/authContext';
import { resolveQuestCharacter } from '@/lib/questAccess';
import { buildDetectionDossier, resolveCharactersByName, type CitableTopic } from '@/lib/quests';
import { loadVoiceProfile } from '@/lib/ai/draftReplies';
import { detectQuestCandidates } from '@/lib/ai/questDetection';

// La détection passe par le CLI Claude local : laisser du temps, comme /api/drafts.
export const maxDuration = 300;

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const body = await request.json().catch(() => ({}));
    const resolution = await resolveQuestCharacter(ctx, body.characterTargetId);
    if (!resolution.ok) return errorResponse(resolution.error, resolution.status, origin);
    const character = resolution.character;

    const count = Math.min(Math.max(parseInt(String(body.count ?? '5'), 10) || 5, 1), 8);
    const instructions =
      typeof body.instructions === 'string' && body.instructions.trim()
        ? body.instructions.trim().slice(0, 2000)
        : undefined;

    const dossier = await buildDetectionDossier(character.id);
    if (!dossier) return errorResponse('Personnage introuvable', 404, origin);
    if (dossier.threads.length === 0) {
      return jsonResponse({ character, candidates: [], threadsRead: 0, motifsRead: 0 }, { origin });
    }

    const [profile, existing] = await Promise.all([
      loadVoiceProfile(character.name),
      prisma.quest.findMany({
        where: { characterId: character.id },
        select: { title: true },
        orderBy: { updatedAt: 'desc' },
        take: 40,
      }),
    ]);

    const raw = await detectQuestCandidates({
      characterName: character.name,
      profile,
      threads: dossier.threads,
      motifs: dossier.motifs,
      motifTopics: dossier.motifTopics,
      existingTitles: existing.map((q) => q.title),
      count,
      instructions,
    });

    // Garde-fou : le modèle ne peut citer que les fils du dossier (détaillés ou
    // désignés par un fil rouge), et ne peut nommer que des personnages connus
    // de la base. Ce qui déborde est écarté plutôt que rattaché à l'aveugle.
    const allowedTopics = new Map<number, CitableTopic>(
      [...dossier.motifTopics, ...dossier.threads].map((t) => [
        t.topicId,
        {
          topicId: t.topicId,
          name: t.name,
          channel: t.channel,
          involved: t.involved,
          silentDays: t.silentDays,
        },
      ])
    );
    // Une ancre ne vaut que si elle vient d'un message effectivement montré au
    // modèle : sinon la « preuve » citerait un identifiant deviné.
    const shownMessages = new Map<number, { topicId: number }>();
    for (const thread of dossier.threads) {
      for (const excerpt of thread.excerpts) shownMessages.set(excerpt.messageId, { topicId: thread.topicId });
    }
    for (const motif of dossier.motifs) {
      for (const quote of motif.quotes) shownMessages.set(quote.messageId, { topicId: quote.topicId });
    }

    const candidates = [];
    for (const candidate of raw) {
      const topicIds = [...new Set(candidate.topicIds)].filter((id) => allowedTopics.has(id));
      if (topicIds.length === 0) continue;

      const messageIds = [...new Set(candidate.messageIds ?? [])].filter((id) => shownMessages.has(id));

      // Le titulaire du carnet n'est pas un « acteur » de sa propre quête : le
      // modèle le cite systématiquement, c'est du bruit dans les chips.
      const { found, unknown } = await resolveCharactersByName(candidate.actors ?? []);
      const actors = found.filter((c) => c.id !== character.id);
      candidates.push({
        ...candidate,
        topicIds,
        messageIds,
        anchors: messageIds.map((id) => {
          const source = shownMessages.get(id)!;
          const topic = allowedTopics.get(source.topicId);
          return { messageId: id, topicId: source.topicId, topicName: topic?.name ?? 'fil inconnu' };
        }),
        topics: topicIds.map((id) => {
          const thread = allowedTopics.get(id)!;
          return {
            topicId: id,
            name: thread.name,
            channel: thread.channel,
            involved: thread.involved,
            silentDays: thread.silentDays,
          };
        }),
        actors: actors.map((c) => ({ targetId: c.targetId, name: c.name })),
        unknownActors: unknown,
      });
    }

    logger.info(
      `Quest detection for ${character.name}: ${candidates.length} candidate(s) from ${dossier.threads.length} thread(s) and ${dossier.motifs.length} recurring motif(s)`
    );
    return jsonResponse(
      {
        character,
        candidates,
        threadsRead: dossier.threads.length,
        motifsRead: dossier.motifs.length,
        motifs: dossier.motifs.map((m) => ({
          term: m.term,
          mentions: m.mentions,
          topicCount: m.topicCount,
          spanDays: m.spanDays,
          silentDays: m.silentDays,
          salience: m.salience,
        })),
      },
      { origin }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error detecting quests: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
