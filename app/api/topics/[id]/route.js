import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight, parseTargetId } from "@/lib/api";
import { getCallerContext } from "@/lib/authContext";

// Verifies the caller has at least one message in the topic OR is admin.
async function canAccessTopic(ctx, topicId) {
  if (ctx.role === "admin") return true;
  if (ctx.characterIds.length === 0) return false;
  const participation = await prisma.messages.findFirst({
    where: { topicId, characterId: { in: ctx.characterIds } },
    select: { id: true },
  });
  return !!participation;
}

export async function GET(request, context) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const { id } = await context.params;
    const topicId = parseTargetId(id);
    if (topicId === null) return errorResponse("Invalid topic id", 400, origin);

    const topic = await prisma.topics.findUnique({
      where: { id: topicId },
      include: {
        forum: { select: { name: true, link: true, type: true, faction: { select: { name: true } } } },
        author: { select: { id: true, targetId: true, name: true } },
        messages: {
          orderBy: { id: "asc" },
          include: { character: { select: { id: true, targetId: true, name: true } } },
        },
      },
    });
    if (!topic) return errorResponse("Topic not found", 404, origin);

    if (!(await canAccessTopic(ctx, topicId))) {
      return errorResponse("Forbidden", 403, origin);
    }

    return jsonResponse(topic, { origin });
  } catch (err) {
    logger.error(`Error fetching topic: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function PATCH(request, context) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const { id } = await context.params;
    const topicId = parseTargetId(id);
    if (topicId === null) return errorResponse("Invalid topic id", 400, origin);

    if (!(await canAccessTopic(ctx, topicId))) {
      return errorResponse("Forbidden", 403, origin);
    }

    const body = await request.json();
    const data = {};
    if (typeof body.closed === "boolean") data.closed = body.closed;
    if (Object.keys(data).length === 0) {
      return errorResponse("No valid fields to update", 400, origin);
    }

    const updated = await prisma.topics.update({
      where: { id: topicId },
      data,
      include: { forum: { select: { type: true } } },
    });
    logger.info(`Topic ${topicId} updated: closed=${updated.closed}`);
    return jsonResponse(
      { id: updated.id, closed: updated.closed, forumType: updated.forum.type },
      { origin }
    );
  } catch (err) {
    if (err.code === "P2025") return errorResponse("Topic not found", 404, origin);
    logger.error(`Error updating topic: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
