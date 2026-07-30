// Fige les dates de messages et fusionne les doublons qu'elles ont produits.
//
// L'ingestion se servait du libellé affiché par le forum comme identité d'un
// message. Or ce libellé bouge : « Aujourd'hui18:51 » devient « Hier18:51 »,
// puis « 30/07/2026 18:51 ». Le même message est donc entré plusieurs fois, et
// un message neuf dont le libellé retombait sur celui d'un ancien était jeté.
// L'ingestion résout maintenant la date à l'arrivée (cf. app/api/forums) ; ce
// script rattrape ce qui est déjà en base.
//
// Usage : pnpm normalize-message-dates [--dry]
//
// Les ancres de quêtes (QuestMessage) suivent la fusion : elles sont
// repointées sur le message conservé avant suppression des copies.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry');

const pad = (n) => String(n).padStart(2, '0');
const isAbsolute = (date) => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(date || '');

/** Même logique que lib/messageDate : le relatif s'ancre sur l'heure de scrape. */
function toAbsolute(date, createdAt) {
  const anchor = createdAt ? new Date(createdAt) : new Date();
  const raw = (date || '').trim();

  const absolute = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D*(\d{1,2}):(\d{2})/);
  if (absolute) {
    const [, day, month, year, hours, minutes] = absolute;
    return `${pad(+day)}/${pad(+month)}/${year} ${pad(+hours)}:${pad(+minutes)}`;
  }

  const time = raw.match(/(\d{1,2}):(\d{2})/);
  const hours = time ? +time[1] : 0;
  const minutes = time ? +time[2] : 0;
  const d = new Date(anchor);
  if (/hier/i.test(raw)) d.setDate(d.getDate() - 1);
  else if (!/aujourd/i.test(raw)) return raw; // forme inconnue : on n'invente pas
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(hours)}:${pad(minutes)}`;
}

const messages = await prisma.messages.findMany({
  select: { id: true, topicId: true, characterId: true, date: true, createdAt: true, content: true },
  orderBy: { id: 'asc' },
});
console.log(`${messages.length} messages en base`);

// 1. Figer les dates relatives.
let fixed = 0;
for (const message of messages) {
  if (isAbsolute(message.date)) continue;
  const date = toAbsolute(message.date, message.createdAt);
  if (date === message.date) continue;
  if (!dryRun) await prisma.messages.update({ where: { id: message.id }, data: { date } });
  message.date = date;
  fixed += 1;
}
console.log(`${fixed} date(s) relative(s) figée(s)`);

// 2. Fusionner les doublons : même fil, même auteur, et même date ou même texte.
const byKey = new Map();
const groups = new Map();
const remember = (key, message) => {
  const kept = byKey.get(key);
  if (kept === undefined) {
    byKey.set(key, message.id);
    return;
  }
  const bucket = groups.get(kept) ?? [];
  bucket.push(message.id);
  groups.set(kept, bucket);
};

for (const message of messages) {
  const base = `${message.topicId}|${message.characterId}`;
  remember(`${base}|d:${message.date}`, message);
  remember(`${base}|c:${message.content.slice(0, 400)}`, message);
}

let merged = 0;
let reanchored = 0;
for (const [keptId, duplicateIds] of groups) {
  const ids = [...new Set(duplicateIds)].filter((id) => id !== keptId);
  if (ids.length === 0) continue;

  if (!dryRun) {
    // Une ancre de quête pointant une copie doit suivre le message conservé,
    // sans créer de doublon d'ancre sur la même quête.
    const anchors = await prisma.questMessage.findMany({ where: { messageId: { in: ids } } });
    for (const anchor of anchors) {
      const already = await prisma.questMessage.findFirst({
        where: { questId: anchor.questId, messageId: keptId },
      });
      if (already) await prisma.questMessage.delete({ where: { id: anchor.id } });
      else await prisma.questMessage.update({ where: { id: anchor.id }, data: { messageId: keptId } });
      reanchored += 1;
    }
    await prisma.messages.deleteMany({ where: { id: { in: ids } } });
  }
  merged += ids.length;
}

console.log(
  `${merged} doublon(s) ${dryRun ? 'à supprimer' : 'supprimé(s)'}` +
    (reanchored ? `, ${reanchored} ancre(s) de quête repointée(s)` : '')
);
if (dryRun) console.log('(--dry : rien n’a été écrit)');

await prisma.$disconnect();
