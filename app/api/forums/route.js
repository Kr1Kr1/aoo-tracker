import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger"; // Custom logger

const prisma = new PrismaClient();

export async function POST(req) {
  try {
    const data = await req.json();

    logger.debug(`[API] Received data: ${JSON.stringify(data, null, 2)}`);

    if (!data) {
      logger.error("[API] No data received in the request body");
      return new Response(JSON.stringify({ error: "No data received" }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    const { forum, topics } = data;

    if (!forum || !topics) {
      logger.error("[API] Invalid forum or topics structure", { forum, topics });
      return new Response(JSON.stringify({ error: "Invalid forum or topics data" }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    logger.info(`[API] Processing forum: ${forum.name} (${forum.link})`);

    // Fetch or create the faction
    let factionId = null;
    if (forum.faction) {
      const faction = await prisma.factions.upsert({
        where: { name: forum.faction },
        create: { name: forum.faction },
        update: {},
      });
      factionId = faction.id;
      logger.info(`[API] Faction resolved: ${faction.name} (ID: ${faction.id})`);
    }

    // Create or update the forum
    const savedForum = await prisma.forums.upsert({
      where: { link: forum.link },
      create: {
        name: forum.name,
        link: forum.link,
        type: forum.type,
        factionId,
      },
      update: {
        name: forum.name,
        type: forum.type,
        factionId,
      },
    });

    logger.info(`[API] Forum saved: ${savedForum.name} (ID: ${savedForum.id})`);

    // Process topics and messages
    for (const topic of topics) {
      logger.info(`[API] Processing topic: ${topic.name} (${topic.link})`);

      // Retrieve the first message in the topic to get the author's targetId
      const firstMessage = topic.messages?.[0];
      if (!firstMessage || !firstMessage.author.targetId) {
        logger.error(
          `[API] First message or author targetId is missing for topic: ${topic.name} (${topic.link})`
        );
        continue;
      }

      const topicAuthor = await prisma.characters.findUnique({
        where: { targetId: firstMessage.author.targetId },
      });

      if (!topicAuthor) {
        logger.error(
          `[API] Topic author not found: ${firstMessage.author.name}. Skipping topic: ${topic.name} (${topic.link})`
        );
        continue;
      }

      const savedTopic = await prisma.topics.upsert({
        where: { link: topic.link },
        create: {
          name: topic.name,
          link: topic.link,
          forumId: savedForum.id,
          authorId: topicAuthor.id,
        },
        update: {
          name: topic.name,
          forumId: savedForum.id,
        },
      });

      logger.info(`[API] Topic saved: ${savedTopic.name} (ID: ${savedTopic.id})`);

      for (const message of topic.messages) {
        logger.info(`[API] Processing message from: ${message.author.name} at ${message.date}`);

        const messageExists = await prisma.messages.findFirst({
          where: {
            topicId: savedTopic.id,
            date: message.date,
            characterId: topicAuthor.id,
          },
        });

        if (messageExists) {
          logger.info(
            `[API] Message already exists: ${message.content.substring(0, 50)}... Skipping.`
          );
          continue;
        }

        const messageAuthor = await prisma.characters.findUnique({
          where: { targetId: message.author.targetId },
        });

        if (!messageAuthor) {
          logger.error(
            `[API] Message author not found: ${message.author.name}. Skipping message.`
          );
          continue;
        }

        await prisma.messages.create({
          data: {
            content: message.content,
            date: message.date,
            topicId: savedTopic.id,
            characterId: messageAuthor.id,
          },
        });

        logger.info(`[API] Message saved: ${message.content.substring(0, 50)}...`);
      }
    }

    logger.info("[API] All forum data processed successfully");
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders(),
    });
  } catch (error) {
    logger.error(`Error in forums API: ${error.message}`, { stack: error.stack });
    return new Response(JSON.stringify({ error: "Failed to save forum data" }), {
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
  