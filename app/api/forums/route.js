import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { toAbsoluteDateString } from "@/lib/messageDate";

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

// Un auteur inconnu de la base ne doit pas coûter un fil. Le scrape des fiches
// (infos.php) ne passe pas par tout le monde : PNJ, comptes fermés, personnages
// jamais croisés. Or on jetait le sujet entier quand son auteur manquait, si
// bien qu'une missive d'Orcrist était sautée à chaque synchro, indéfiniment.
// On crée donc la fiche minimale : le forum nous donne son targetId et son nom,
// le reste se remplira au premier passage sur sa fiche.
async function resolveAuthor(author) {
  if (!author?.targetId) return null;
  const known = await prisma.characters.findUnique({ where: { targetId: author.targetId } });
  if (known) return known;
  if (!author.name) return null;

  const created = await prisma.characters.create({
    data: { targetId: author.targetId, name: author.name },
  });
  logger.info(`Character created from forum data: ${author.name} (${author.targetId})`);
  return created;
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

      const topicAuthor = await resolveAuthor(firstMessage.author);
      if (!topicAuthor) {
        logger.warn(`Topic author unusable (no name): ${topic.name}`);
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
        const messageAuthor = await resolveAuthor(message.author);
        if (!messageAuthor) {
          logger.warn(`Message author unusable (no name) in ${topic.name}`);
          continue;
        }

        // Le forum affiche « Aujourd'hui18:51 », puis « Hier18:51 », puis la
        // date pleine : trois libellés pour un même message. On le résout ici,
        // sinon l'identité d'un message change d'un jour à l'autre (doublons)
        // et un message neuf peut retomber sur le libellé d'un ancien, auquel
        // cas il était jeté comme déjà connu.
        const date = toAbsoluteDateString(message.date, new Date());

        const exists = await prisma.messages.findFirst({
          where: {
            topicId: savedTopic.id,
            characterId: messageAuthor.id,
            OR: [{ date }, { content: message.content }],
          },
          select: { id: true, date: true },
        });
        if (exists) {
          // Ancien enregistrement au libellé relatif : on le fige maintenant.
          if (exists.date !== date && !/^\d{1,2}\/\d{1,2}\/\d{4}/.test(exists.date)) {
            await prisma.messages.update({ where: { id: exists.id }, data: { date } });
          }
          continue;
        }

        await prisma.messages.create({
          data: {
            content: message.content,
            date,
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
