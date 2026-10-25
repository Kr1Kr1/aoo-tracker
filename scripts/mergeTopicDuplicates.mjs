// Merges the duplicate Topics rows created by the old scraper.
//
// Until the fix in aoo-extension, a topic link was stored with the anchor
// fragment of its last message ("forum.php?topic=123#456"). That fragment
// changes on every reply, so `topics.upsert({ where: { link } })` inserted a
// brand new row on each sync and scattered the messages across the copies.
//
// This script groups topics by their link stripped of fragment and page param,
// keeps the lowest id of each group, moves every message onto it and drops the
// leftovers. Messages are de-duplicated on (date, characterId), the same key
// the ingestion route uses, keeping the highest id: the most recent scrape, so
// posts edited between two syncs keep their latest version.
//
// Quests point at topics (QuestTopic) and at messages (QuestMessage, deleted in
// cascade with its message): both are moved onto the surviving row first, so a
// merge never loses a quest's anchors.
//
// Usage: node scripts/mergeTopicDuplicates.mjs [--apply]
//        (dry run by default)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function baseLink(link) {
  try {
    const url = new URL(link);
    url.hash = "";
    url.searchParams.delete("page");
    return url.toString();
  } catch {
    return String(link).split("#")[0].replace(/[?&]page=\d+/g, "");
  }
}

async function main() {
  // Read updatedAt as a raw epoch so it can be rewritten verbatim: Prisma's
  // @updatedAt would otherwise bump every merged topic to now and wreck the
  // "last activity" ordering the missives page relies on.
  const topics = await prisma.$queryRaw`
    SELECT id, name, link, forumId, authorId,
           CAST(closed AS INTEGER) AS closed,
           CAST(updatedAt AS INTEGER) AS updatedAtMs
    FROM Topics`;

  const groups = new Map();
  for (const t of topics) {
    const key = baseLink(t.link);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const dupGroups = [...groups.entries()].filter(([, g]) => g.length > 1);
  const fragmentOnly = [...groups.entries()].filter(
    ([key, g]) => g.length === 1 && g[0].link !== key
  );

  console.log(`${topics.length} topic rows -> ${groups.size} real topics`);
  console.log(`  ${dupGroups.length} groups to merge`);
  console.log(`  ${fragmentOnly.length} single topics to renormalize`);

  let mergedRows = 0;
  let movedMessages = 0;
  let droppedMessages = 0;

  for (const [key, group] of dupGroups) {
    group.sort((a, b) => a.id - b.id);
    const canonical = group[0];
    const others = group.slice(1);

    // Keep the freshest metadata; a topic closed by hand in any copy stays closed.
    const newest = group.reduce((a, b) => (b.updatedAtMs > a.updatedAtMs ? b : a));
    const closed = group.some((t) => t.closed) ? 1 : 0;

    const ids = group.map((t) => t.id);
    const messages = await prisma.messages.findMany({
      where: { topicId: { in: ids } },
      select: { id: true, date: true, characterId: true },
      orderBy: { id: "asc" },
    });

    const keepByKey = new Map();
    for (const m of messages) keepByKey.set(`${m.date}|${m.characterId}`, m.id);
    const keep = new Set(keepByKey.values());
    // Where each dropped message's quest anchors must land.
    const survivorOf = new Map(
      messages.map((m) => [m.id, keepByKey.get(`${m.date}|${m.characterId}`)])
    );
    const toMove = messages.filter((m) => keep.has(m.id) && m.id !== undefined);
    const toDrop = messages.filter((m) => !keep.has(m.id));

    movedMessages += toMove.length;
    droppedMessages += toDrop.length;
    mergedRows += others.length;

    if (!APPLY) {
      console.log(
        `  ${key}\n    keep #${canonical.id}, drop ${others.map((t) => `#${t.id}`).join(" ")}` +
          ` | ${messages.length} messages -> ${toMove.length} kept, ${toDrop.length} duplicates removed`
      );
      continue;
    }

    await prisma.$transaction(async (tx) => {
      for (const link of await tx.questMessage.findMany({
        where: { messageId: { in: toDrop.map((m) => m.id) } },
      })) {
        const target = survivorOf.get(link.messageId);
        const exists = await tx.questMessage.findFirst({
          where: { questId: link.questId, messageId: target },
        });
        if (exists) await tx.questMessage.delete({ where: { id: link.id } });
        else await tx.questMessage.update({ where: { id: link.id }, data: { messageId: target } });
      }
      for (const link of await tx.questTopic.findMany({
        where: { topicId: { in: others.map((t) => t.id) } },
      })) {
        const exists = await tx.questTopic.findFirst({
          where: { questId: link.questId, topicId: canonical.id },
        });
        if (exists) await tx.questTopic.delete({ where: { id: link.id } });
        else await tx.questTopic.update({ where: { id: link.id }, data: { topicId: canonical.id } });
      }
      if (toDrop.length > 0) {
        await tx.messages.deleteMany({ where: { id: { in: toDrop.map((m) => m.id) } } });
      }
      await tx.messages.updateMany({
        where: { id: { in: toMove.map((m) => m.id) } },
        data: { topicId: canonical.id },
      });
      await tx.topics.deleteMany({ where: { id: { in: others.map((t) => t.id) } } });
      await tx.$executeRaw`
        UPDATE Topics SET link = ${key}, name = ${newest.name}, closed = ${closed},
               updatedAt = ${newest.updatedAtMs}
        WHERE id = ${canonical.id}`;
    });
  }

  for (const [key, group] of fragmentOnly) {
    const t = group[0];
    if (!APPLY) {
      console.log(`  renormalize #${t.id}`);
      continue;
    }
    await prisma.$executeRaw`
      UPDATE Topics SET link = ${key}, updatedAt = ${t.updatedAtMs} WHERE id = ${t.id}`;
  }

  console.log(
    `\n${APPLY ? "Applied" : "Dry run"}: ${mergedRows} duplicate topic rows removed, ` +
      `${movedMessages} messages kept, ${droppedMessages} duplicate messages removed, ` +
      `${fragmentOnly.length} links renormalized`
  );
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
