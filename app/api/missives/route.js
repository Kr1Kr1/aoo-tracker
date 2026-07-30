import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext, visibleMissiveTopicIds } from "@/lib/authContext";
import { messageTime, sortMessagesChronologically } from "@/lib/messageDate";

// Returns all missive topics (Forums.type === "Missives") visible to the caller,
// with a derived status for each: "closed" | "needs_reply" | "waiting".
export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    // Une missive reçue et jamais répondue n'a aucun message de soi : la règle
    // de visibilité vit dans lib/authContext, pour rester la même partout.
    const visibleIds = await visibleMissiveTopicIds(ctx);

    // Message headers only (no content): enough to order topics the way the
    // game does, i.e. by the date of their last message. `Topics.updatedAt` is
    // bumped by every sync, so it tracks scrape time, not thread activity.
    const topics = await prisma.topics.findMany({
      where: { forum: { type: "Missives" } },
      include: {
        forum: { select: { name: true, link: true } },
        author: { select: { id: true, targetId: true, name: true } },
        messages: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            date: true,
            createdAt: true,
            character: { select: { id: true, targetId: true, name: true } },
          },
        },
      },
    });

    const myCharIdSet = new Set(ctx.characterIds);

    const enriched = topics.map((topic) => {
      const messages = sortMessagesChronologically(topic.messages);
      const lastMessage = messages[messages.length - 1];
      const lastIsMine = lastMessage ? myCharIdSet.has(lastMessage.character.id) : false;
      const status = topic.closed
        ? "closed"
        : lastIsMine
          ? "waiting"
          : "needs_reply";
      return {
        id: topic.id,
        name: topic.name,
        link: topic.link,
        closed: topic.closed,
        status,
        messageCount: messages.length,
        author: topic.author,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              date: lastMessage.date,
              author: lastMessage.character,
              isMine: lastIsMine,
            }
          : null,
        lastActivity: lastMessage
          ? new Date(messageTime(lastMessage)).toISOString()
          : topic.updatedAt,
        updatedAt: topic.updatedAt,
      };
    });

    enriched.sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );

    const visibleSet = visibleIds === null ? null : new Set(visibleIds);
    const filtered = visibleSet === null ? enriched : enriched.filter((t) => visibleSet.has(t.id));

    logger.info(`Missives: returned ${filtered.length} topics for ${ctx.username}`);
    return jsonResponse({ topics: filtered }, { origin });
  } catch (err) {
    logger.error(`Error fetching missives: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
