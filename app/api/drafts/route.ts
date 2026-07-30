import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext, canAccessTargetId } from "@/lib/authContext";
import {
  loadVoiceProfile,
  htmlToPlainText,
  generateDraftReplies,
} from "@/lib/ai/draftReplies";

// Generation shells out to the local Claude CLI; give it room.
export const maxDuration = 300;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const body = await request.json().catch(() => ({}));
    const topicId = parseInt(String(body.topicId ?? ""), 10);
    if (Number.isNaN(topicId)) return errorResponse("topicId required", 400, origin);
    const count = Math.min(Math.max(parseInt(String(body.count ?? "3"), 10) || 3, 1), 5);
    const instructions =
      typeof body.instructions === "string" && body.instructions.trim()
        ? body.instructions.trim().slice(0, 2000)
        : undefined;

    const topic = await prisma.topics.findUnique({
      where: { id: topicId },
      include: {
        messages: {
          orderBy: { id: "asc" },
          include: { character: { select: { id: true, targetId: true, name: true } } },
        },
      },
    });
    if (!topic) return errorResponse("Topic not found", 404, origin);

    // Same visibility rule as the missives page: admin, or a thread the
    // caller's characters participate in.
    const mine = new Set(ctx.characterIds);
    const participates = topic.messages.some((m) => mine.has(m.character.id));
    if (ctx.role !== "admin" && !participates) {
      return errorResponse("Forbidden", 403, origin);
    }

    // Who replies: explicit param > acting-as > the caller's character
    // already present in the thread (their most recent one).
    let speakerName: string | null = null;
    let speakerCharacterId: number | null = null;
    const explicitTargetId = body.characterTargetId ?? ctx.actingAsTargetId;
    if (explicitTargetId != null) {
      const targetId = parseInt(String(explicitTargetId), 10);
      if (Number.isNaN(targetId) || !canAccessTargetId(ctx, targetId)) {
        return errorResponse("Forbidden: characterTargetId not linked to this user", 403, origin);
      }
      const character = await prisma.characters.findUnique({
        where: { targetId },
        select: { id: true, name: true },
      });
      speakerName = character?.name ?? null;
      speakerCharacterId = character?.id ?? null;
    } else {
      const own = topic.messages.filter((m) => mine.has(m.character.id));
      speakerName = own[own.length - 1]?.character.name ?? null;
      speakerCharacterId = own[own.length - 1]?.character.id ?? null;
    }
    if (!speakerName) {
      return errorResponse(
        "Impossible de déterminer le personnage qui répond — précisez characterTargetId",
        400,
        origin
      );
    }

    const profile = await loadVoiceProfile(speakerName);
    if (!profile) {
      return errorResponse(`Aucun profil de voix pour ${speakerName}`, 404, origin);
    }

    const transcript = topic.messages.slice(-40).map((m) => ({
      author: m.character.name,
      date: m.date,
      text: htmlToPlainText(m.content),
    }));

    // Style anchor: what this character actually wrote lately in this kind of
    // forum. A written profile drifts; real messages do not.
    const recentSamples = speakerCharacterId
      ? (
          await prisma.messages.findMany({
            where: {
              characterId: speakerCharacterId,
              topicId: { not: topic.id },
              topic: { forumId: topic.forumId },
            },
            orderBy: { id: "desc" },
            take: 6,
            select: { content: true },
          })
        ).map((m) => htmlToPlainText(m.content).slice(0, 900))
      : [];

    const drafts = await generateDraftReplies({
      characterName: speakerName,
      profile,
      topicName: topic.name,
      transcript,
      recentSamples,
      count,
      instructions,
    });

    logger.info(`Generated ${drafts.length} draft replies as ${speakerName} for topic ${topicId}`);
    return jsonResponse({ character: speakerName, drafts }, { origin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error generating drafts: ${message}`);
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get("origin"));
}
