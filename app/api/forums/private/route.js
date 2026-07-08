import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";

export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const forums = await prisma.forums.findMany({
      where: { type: "Private" },
      include: {
        topics: {
          include: {
            author: true,
            messages: {
              include: { character: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            _count: { select: { messages: true } },
          },
        },
        faction: true,
      },
    });

    const formatted = forums.map((forum) => ({
      name: forum.name,
      link: forum.link,
      faction: forum.faction?.name || null,
      topics: forum.topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        link: topic.link,
        author: {
          name: topic.author?.name || "Unknown Author",
          targetId: topic.author?.targetId || null,
        },
        messageCount: topic._count.messages,
        lastMessageDate: topic.messages[0]?.date || null,
      })),
    }));

    logger.info(`Returned ${formatted.length} private forums`);
    return jsonResponse({ forums: formatted }, { origin });
  } catch (err) {
    logger.error(`Error fetching private forums: ${err.message}`, { stack: err.stack });
    return errorResponse("Failed to fetch private forums", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
