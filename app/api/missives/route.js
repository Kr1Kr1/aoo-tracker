import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext, visibleCharacterIds } from "@/lib/authContext";

// Returns all missive topics (Forums.type === "Missives") visible to the caller,
// with a derived status for each: "closed" | "needs_reply" | "waiting".
export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const allowedCharIds = await visibleCharacterIds(ctx);

    const topics = await prisma.topics.findMany({
      where: { forum: { type: "Missives" } },
      include: {
        forum: { select: { name: true, link: true } },
        author: { select: { id: true, targetId: true, name: true } },
        messages: {
          orderBy: { id: "desc" },
          take: 1,
          include: { character: { select: { id: true, targetId: true, name: true } } },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const myCharIdSet = new Set(ctx.characterIds);

    const enriched = topics.map((topic) => {
      const lastMessage = topic.messages[0];
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
        messageCount: topic._count.messages,
        author: topic.author,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              date: lastMessage.date,
              author: lastMessage.character,
              isMine: lastIsMine,
            }
          : null,
        updatedAt: topic.updatedAt,
      };
    });

    // Optionally narrow by acting-as via visibleCharacterIds: a missive is
    // "mine" if any of its messages' authors is in my character set.
    const filtered =
      allowedCharIds === null
        ? enriched
        : await filterByParticipation(enriched, new Set(allowedCharIds));

    logger.info(`Missives: returned ${filtered.length} topics for ${ctx.username}`);
    return jsonResponse({ topics: filtered }, { origin });
  } catch (err) {
    logger.error(`Error fetching missives: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

// A topic is visible to a user if any participant (message author) is one
// of the user's linked characters.
async function filterByParticipation(topics, allowedCharIdSet) {
  if (topics.length === 0) return topics;
  const topicIds = topics.map((t) => t.id);
  const participations = await prisma.messages.findMany({
    where: { topicId: { in: topicIds }, characterId: { in: [...allowedCharIdSet] } },
    select: { topicId: true },
    distinct: ["topicId"],
  });
  const visibleIds = new Set(participations.map((p) => p.topicId));
  return topics.filter((t) => visibleIds.has(t.id));
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
