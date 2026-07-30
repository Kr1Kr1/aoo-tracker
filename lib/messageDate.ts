// `Messages.date` stores whatever the forum displayed at scrape time, so three
// shapes coexist in the DB:
//   "01/08/202516:56"     dd/MM/yyyy + HH:mm (the "à" separator is eaten by the scraper)
//   "01/08/2025 à 16:56"  older extension builds
//   "Aujourd'hui15:17" / "Hier21:22"   relative, frozen at the moment of the scrape
//
// Relative labels are anchored on `createdAt` (the ingestion time) rather than
// on "now": a message scraped as "Hier" three weeks ago means the day before
// that scrape, not yesterday.

type DatedMessage = { date?: string | null; createdAt?: Date | string | null };

export function parseMessageDate(
  date?: string | null,
  createdAt?: Date | string | null
): Date {
  const anchor = createdAt ? new Date(createdAt) : new Date();
  const raw = (date || '').trim();

  const absolute = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D*(\d{1,2}):(\d{2})/);
  if (absolute) {
    const [, day, month, year, hours, minutes] = absolute;
    return new Date(+year, +month - 1, +day, +hours, +minutes);
  }

  const time = raw.match(/(\d{1,2}):(\d{2})/);
  const hours = time ? +time[1] : 0;
  const minutes = time ? +time[2] : 0;

  if (/aujourd/i.test(raw)) {
    const d = new Date(anchor);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }
  if (/hier/i.test(raw)) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - 1);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  // Unknown shape: ingestion time is the least-wrong guess we have.
  return anchor;
}

export function messageTime(message: DatedMessage): number {
  return parseMessageDate(message.date, message.createdAt).getTime();
}

// Chronological order, oldest first: the order the thread reads in game.
export function sortMessagesChronologically<T extends DatedMessage & { id: number }>(
  messages: T[]
): T[] {
  return [...messages].sort((a, b) => messageTime(a) - messageTime(b) || a.id - b.id);
}

const pad = (n: number) => String(n).padStart(2, '0');

// Deterministic formatting (no locale lookup) so server and client agree.
export function formatMessageDate(message: DatedMessage): string {
  if (!message.date) return '—';
  const d = parseMessageDate(message.date, message.createdAt);
  if (Number.isNaN(d.getTime())) return String(message.date);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
