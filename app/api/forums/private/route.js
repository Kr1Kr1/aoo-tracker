import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger"; // Custom logger

const prisma = new PrismaClient();

export async function GET(req) {
  try {
    // Fetch all private forums and their topics
    const forums = await prisma.forums.findMany({
      where: { type: "Private" },
      include: {
        topics: {
          include: {
            author: true,
            messages: {
              include: { character: true },
            },
          },
        },
        faction: true, // Include faction details if needed
      },
    });

    // Format the response to include only necessary data
    const formattedForums = forums.map((forum) => ({
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
        messageCount: topic.messages.length,
        lastMessageDate: topic.messages.at(-1)?.date || null,
      })),
    }));

    logger.info(`[API] Fetched ${formattedForums.length} private forums with topics`);
    logger.debug(`[API] Response data: ${JSON.stringify(formattedForums, null, 2)}`);

    return new Response(JSON.stringify({ forums: formattedForums }), {
      status: 200,
      headers: corsHeaders(),
    });
  } catch (error) {
    logger.error(`Error in fetching private forums: ${error.message}`, {
      stack: error.stack,
    });
    return new Response(JSON.stringify({ error: "Failed to fetch private forums" }), {
      status: 500,
      headers: corsHeaders(),
    });
  } finally {
    await prisma.$disconnect();
  }
}

export async function OPTIONS(req) {
    return new Response(null, {
      headers: corsHeaders(),
      status: 204, // No content
    });
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": "true",
    };
}
  