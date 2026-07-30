import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";

// `link` is the upsert key for a topic, so it has to identify the topic and
// nothing else. The forum serves topic hrefs with a "#lastMessageId" fragment
// that changes on every reply: keeping it made each sync insert a new row and
// scatter the messages across the copies. Older extension builds still send
// those, so normalize here too rather than trusting the client.
function normalizeTopicLink(link) {
  try {
    const url = new URL(link);
    url.hash = "";
    url.searchParams.delete("page");
    return url.toString();
  } catch {
    return String(link).split("#")[0].replace(/[?&]page=\d+/g, "");
  }
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  try {
    const data = await request.json();
    const { forum, topics } = data || {};
    if (!forum || !topics) {
      return errorResponse("Invalid forum or topics data", 400, origin);
    }

    let factionId = null;
    if (forum.faction) {
      const faction = await prisma.factions.upsert({
        where: { name: forum.faction },
        create: { name: forum.faction },
        update: {},
      });
      factionId = faction.id;
    }

    const savedForum = await prisma.forums.upsert({
      where: { link: forum.link },
      create: { name: forum.name, link: forum.link, type: forum.type, factionId },
      update: { name: forum.name, type: forum.type, factionId },
    });

    let topicCount = 0;
    let messageCount = 0;
    let skippedCount = 0;

    for (const topic of topics) {
      const firstMessage = topic.messages?.[0];
      if (!firstMessage?.author?.targetId) {
        logger.warn(`Skipping topic with missing author: ${topic.name}`);
        skippedCount++;
        continue;
      }

      const topicAuthor = await prisma.characters.findUnique({
        where: { targetId: firstMessage.author.targetId },
      });
      if (!topicAuthor) {
        logger.warn(`Topic author not found: ${firstMessage.author.name}`);
        skippedCount++;
        continue;
      }

      const topicLink = normalizeTopicLink(topic.link);
      const savedTopic = await prisma.topics.upsert({
        where: { link: topicLink },
        create: {
          name: topic.name,
          link: topicLink,
          forumId: savedForum.id,
          authorId: topicAuthor.id,
        },
        update: { name: topic.name, forumId: savedForum.id },
      });
      topicCount++;

      for (const message of topic.messages) {
        if (!message.author?.targetId) continue;

        // Resolve the actual message author (NOT the topic author —
        // a topic can have replies from many different characters).
        const messageAuthor = await prisma.characters.findUnique({
          where: { targetId: message.author.targetId },
        });
        if (!messageAuthor) {
          logger.warn(`Message author not found: ${message.author.name}`);
          continue;
        }

        const exists = await prisma.messages.findFirst({
          where: {
            topicId: savedTopic.id,
            date: message.date,
            characterId: messageAuthor.id,
          },
        });
        if (exists) continue;

        await prisma.messages.create({
          data: {
            content: message.content,
            date: message.date,
            topicId: savedTopic.id,
            characterId: messageAuthor.id,
          },
        });
        messageCount++;
      }
    }

    logger.info(
      `Forum ${forum.name}: ${topicCount} topics, ${messageCount} new messages, ${skippedCount} skipped`
    );
    return jsonResponse({ success: true, topicCount, messageCount, skippedCount }, { origin });
  } catch (err) {
    logger.error(`Error in forums API: ${err.message}`, { stack: err.stack });
    return errorResponse("Failed to save forum data", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
