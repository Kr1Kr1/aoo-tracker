import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext } from "@/lib/authContext";

// Returns { link: storedMessageCount } for every topic, so the scraper can
// compare against the "Réponses" column of a forum listing and only re-fetch
// the topics that actually grew — and only their trailing pages.
//
// Optional ?forum=<name> narrows the answer to one forum.
export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const forumName = new URL(request.url).searchParams.get("forum");

    const topics = await prisma.topics.findMany({
      where: forumName ? { forum: { name: forumName } } : undefined,
      select: { link: true, _count: { select: { messages: true } } },
    });

    const counts = {};
    for (const topic of topics) counts[topic.link] = topic._count.messages;

    logger.info(
      `Topic counts: ${topics.length} topics${forumName ? ` for ${forumName}` : ""} for ${ctx.username}`
    );
    return jsonResponse({ counts }, { origin });
  } catch (err) {
    logger.error(`Error fetching topic counts: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
