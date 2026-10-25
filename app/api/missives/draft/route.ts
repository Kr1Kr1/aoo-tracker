import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonResponse, errorResponse, preflight } from '@/lib/api';
import { getCallerContext, canAccessTargetId } from '@/lib/authContext';
import { loadVoiceProfile } from '@/lib/ai/draftReplies';
import { loadVoiceSamples } from '@/lib/ai/voiceSamples';
import { gatherMissiveCorpus } from '@/lib/missiveCorpus';
import { generateNewMissive } from '@/lib/ai/newMissive';

// Le CLI Claude local prend son temps, comme /api/drafts.
export const maxDuration = 300;

const MAX_RECIPIENTS = 4;

function parseRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;]/) : [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of list) {
    const name = String(entry ?? '').trim().slice(0, 60);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_RECIPIENTS) break;
  }
  return names;
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse('Unauthorized', 401, origin);

    const body = await request.json().catch(() => ({}));
    const intent =
      typeof body.intent === 'string' && body.intent.trim()
        ? body.intent.trim().slice(0, 4000)
        : null;
    if (!intent) {
      return errorResponse('Dites ce que vous voulez écrire : sans intention, il n\'y a rien à servir', 400, origin);
    }
    const subject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim().slice(0, 120)
        : undefined;
    const recipients = parseRecipients(body.recipients ?? body.recipient);
    const count = Math.min(Math.max(parseInt(String(body.count ?? '2'), 10) || 2, 1), 4);

    // Qui écrit : paramètre explicite, sinon le personnage joué, sinon le seul
    // personnage du compte. Un fil neuf n'a aucun message d'où le déduire.
    const explicitTargetId = body.characterTargetId ?? ctx.actingAsTargetId;
    let speaker: { id: number; name: string } | null = null;
    if (explicitTargetId != null) {
      const targetId = parseInt(String(explicitTargetId), 10);
      if (Number.isNaN(targetId) || !canAccessTargetId(ctx, targetId)) {
        return errorResponse('Forbidden: characterTargetId not linked to this user', 403, origin);
      }
      speaker = await prisma.characters.findUnique({
        where: { targetId },
        select: { id: true, name: true },
      });
    } else if (ctx.characterIds.length === 1) {
      speaker = await prisma.characters.findUnique({
        where: { id: ctx.characterIds[0] },
        select: { id: true, name: true },
      });
    }
    if (!speaker) {
      return errorResponse(
        'Impossible de déterminer le personnage qui écrit : choisissez un personnage (« jouer en tant que ») ou précisez characterTargetId',
        400,
        origin
      );
    }

    // Le ton se prend d'abord dans le canal visé : une missive ne s'écrit pas
    // comme un RP. On vise le forum de missives où ce personnage écrit déjà.
    const ownMissive = await prisma.messages.findFirst({
      where: { characterId: speaker.id, topic: { forum: { type: 'Missives' } } },
      orderBy: { id: 'desc' },
      select: { topic: { select: { forumId: true } } },
    });
    const missiveForum =
      ownMissive?.topic.forumId ??
      (await prisma.forums.findFirst({ where: { type: 'Missives' }, select: { id: true } }))?.id ??
      null;

    const [profile, samples, corpus] = await Promise.all([
      loadVoiceProfile(speaker.name),
      loadVoiceSamples({ characterId: speaker.id, forumId: missiveForum }),
      gatherMissiveCorpus({ ctx, speakerName: speaker.name, recipients, subject, intent }),
    ]);

    const drafts = await generateNewMissive({
      characterName: speaker.name,
      profile,
      samples,
      corpus,
      intent,
      subject,
      count,
    });

    logger.info(
      `New missive drafts as ${speaker.name} to [${corpus.recipients.join(', ') || '?'}]: ${drafts.length} draft(s), ${corpus.withRecipient.length} thread(s) with recipient, ${corpus.related.length} related, ${samples.length} voice sample(s)`
    );

    return jsonResponse(
      {
        character: speaker.name,
        drafts,
        voiceSamples: samples.length,
        // De quoi montrer sur quoi la rédaction s'est appuyée : un brouillon
        // qu'on ne sait pas sourcer ne se relit pas.
        context: {
          recipients: corpus.recipients,
          unknownRecipients: corpus.unknownRecipients,
          withRecipient: corpus.withRecipient.map((t) => ({ name: t.name, lastLabel: t.lastLabel })),
          related: corpus.related.map((t) => ({ name: t.name, reason: t.reason })),
          scannedTopics: corpus.scannedTopics,
        },
      },
      { origin }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error drafting new missive: ${message}`);
    return errorResponse('Internal Server Error', 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}
