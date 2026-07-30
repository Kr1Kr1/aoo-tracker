import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCallerContextFromCookies, visibleMissiveTopicIds } from '@/lib/authContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { sanitizeForumHtml } from '@/lib/sanitizeForumHtml';
import { MissiveThread } from '@/components/missive-thread';
import { formatMessageDate, messageTime, sortMessagesChronologically } from '@/lib/messageDate';

interface PageProps {
  searchParams: Promise<{ filter?: string; sort?: string; page?: string }>;
}

// Threads are rendered in full, so the list itself is paginated: an admin sees
// every missive of the game and the whole set at once weighs several MB.
const TOPICS_PER_PAGE = 20;

const STATUS_LABEL: Record<string, string> = {
  needs_reply: '🔴 À répondre',
  waiting: '🟡 En attente',
  closed: '🔘 Clôturée',
};

const STATUS_COLOR: Record<string, string> = {
  needs_reply: 'bg-red-100 text-red-800',
  waiting: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-gray-200 text-gray-700',
};

async function toggleClosed(formData: FormData) {
  'use server';
  const ctx = await getCallerContextFromCookies();
  if (!ctx) redirect('/login');

  const topicId = parseInt(String(formData.get('topicId') || ''), 10);
  const closed = formData.get('closed') === 'true';
  if (Number.isNaN(topicId)) return;

  // Same access control as PATCH /api/topics/[id]
  if (ctx.role !== 'admin') {
    const participation = await prisma.messages.findFirst({
      where: { topicId, characterId: { in: ctx.characterIds } },
      select: { id: true },
    });
    if (!participation) return;
  }

  await prisma.topics.update({ where: { id: topicId }, data: { closed } });
  revalidatePath('/forum/missives');
}

export default async function MissivesPage({ searchParams }: PageProps) {
  const ctx = await getCallerContextFromCookies();
  if (!ctx) redirect('/login');

  const params = await searchParams;
  const filter = params.filter || 'all';
  const sort = params.sort === 'oldest' ? 'oldest' : 'newest';

  const charIdSet = new Set(ctx.characterIds);

  const allTopics = await prisma.topics.findMany({
    where: { forum: { type: 'Missives' } },
    include: {
      author: { select: { id: true, targetId: true, name: true } },
      messages: {
        orderBy: { id: 'asc' },
        include: { character: { select: { id: true, targetId: true, name: true } } },
      },
    },
  });

  // Visibilité : la règle vit dans lib/authContext, pour que la page, l'API et
  // les quêtes disent la même chose. Une missive reçue et jamais répondue n'a
  // aucun message de soi : elle reste pourtant la sienne.
  const visibleIds = await visibleMissiveTopicIds(ctx);
  const visibleTopics =
    visibleIds === null
      ? allTopics
      : ((ids) => allTopics.filter((t) => ids.has(t.id)))(new Set(visibleIds));

  const enriched = visibleTopics.map((t) => {
    // `Topics.updatedAt` is bumped by every sync, so it tracks scrape time, not
    // thread activity. The game orders missives by their last message: do the same.
    const messages = sortMessagesChronologically(t.messages);
    const last = messages[messages.length - 1];
    const lastIsMine = last ? charIdSet.has(last.character.id) : false;
    const status = t.closed ? 'closed' : lastIsMine ? 'waiting' : 'needs_reply';
    return {
      ...t,
      messages,
      status,
      lastIsMine,
      last,
      lastActivity: last ? messageTime(last) : new Date(t.updatedAt).getTime(),
    };
  });

  enriched.sort((a, b) =>
    sort === 'newest' ? b.lastActivity - a.lastActivity : a.lastActivity - b.lastActivity
  );

  const matching = enriched.filter((t) => filter === 'all' || t.status === filter);

  const pageCount = Math.max(1, Math.ceil(matching.length / TOPICS_PER_PAGE));
  const page = Math.min(Math.max(parseInt(params.page || '1', 10) || 1, 1), pageCount);
  const filtered = matching.slice((page - 1) * TOPICS_PER_PAGE, page * TOPICS_PER_PAGE);
  const href = (next: { filter?: string; sort?: string; page?: number }) =>
    `?filter=${next.filter ?? filter}&sort=${next.sort ?? sort}&page=${next.page ?? 1}`;

  const counts = {
    all: enriched.length,
    needs_reply: enriched.filter((t) => t.status === 'needs_reply').length,
    waiting: enriched.filter((t) => t.status === 'waiting').length,
    closed: enriched.filter((t) => t.status === 'closed').length,
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Missives</h1>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} className="w-fit">
          <TabsList>
            <a href={href({ filter: 'all' })}><TabsTrigger value="all">Toutes ({counts.all})</TabsTrigger></a>
            <a href={href({ filter: 'needs_reply' })}><TabsTrigger value="needs_reply">🔴 À répondre ({counts.needs_reply})</TabsTrigger></a>
            <a href={href({ filter: 'waiting' })}><TabsTrigger value="waiting">🟡 En attente ({counts.waiting})</TabsTrigger></a>
            <a href={href({ filter: 'closed' })}><TabsTrigger value="closed">🔘 Clôturées ({counts.closed})</TabsTrigger></a>
          </TabsList>
        </Tabs>
        <a
          href={href({ sort: sort === 'newest' ? 'oldest' : 'newest' })}
          className="ml-auto"
        >
          <Button variant="outline" size="sm">
            {sort === 'newest' ? '↓ Plus récentes d\'abord' : '↑ Plus anciennes d\'abord'}
          </Button>
        </a>
      </div>

      {matching.length === 0 && (
        <p className="text-muted-foreground">Aucune missive {filter !== 'all' && `dans cette catégorie`}.</p>
      )}

      {pageCount > 1 && (
        <p className="text-xs text-muted-foreground">
          Missives {(page - 1) * TOPICS_PER_PAGE + 1}–
          {Math.min(page * TOPICS_PER_PAGE, matching.length)} sur {matching.length} · page {page}/
          {pageCount}
        </p>
      )}

      <div className="space-y-3">
        {filtered.map((topic) => (
          <Card key={topic.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-base">
                  <span
                    className={`mr-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[topic.status]}`}
                  >
                    {STATUS_LABEL[topic.status]}
                  </span>
                  {topic.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {topic.messages.length} message{topic.messages.length > 1 ? 's' : ''} ·
                  Dernier : {topic.last?.character.name || '?'} ·{' '}
                  {topic.last ? formatMessageDate(topic.last) : '—'}
                </p>
              </div>
              <form action={toggleClosed}>
                <input type="hidden" name="topicId" value={topic.id} />
                <input type="hidden" name="closed" value={topic.closed ? 'false' : 'true'} />
                <Button type="submit" variant="outline" size="sm">
                  {topic.closed ? 'Réouvrir' : 'Clôturer'}
                </Button>
              </form>
            </CardHeader>
            <CardContent>
              {/* Thread oldest first, folded by default, paginated like in game. */}
              <MissiveThread
                topicId={topic.id}
                closed={topic.closed}
                posts={topic.messages.map((m) => ({
                  id: m.id,
                  author: m.character.name,
                  date: formatMessageDate(m),
                  html: sanitizeForumHtml(m.content),
                  isMine: charIdSet.has(m.character.id),
                }))}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <a href={href({ page: page - 1 })}>
              <Button variant="outline" size="sm">← Précédentes</Button>
            </a>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            page {page}/{pageCount}
          </span>
          {page < pageCount ? (
            <a href={href({ page: page + 1 })}>
              <Button variant="outline" size="sm">Suivantes →</Button>
            </a>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
