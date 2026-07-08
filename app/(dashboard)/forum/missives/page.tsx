import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCallerContextFromCookies } from '@/lib/authContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { sanitizeForumHtml } from '@/lib/sanitizeForumHtml';

interface PageProps {
  searchParams: Promise<{ filter?: string; sort?: string }>;
}

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
  const isAdmin = ctx.role === 'admin';

  const allTopics = await prisma.topics.findMany({
    where: { forum: { type: 'Missives' } },
    include: {
      author: { select: { id: true, targetId: true, name: true } },
      messages: {
        orderBy: { id: 'asc' },
        include: { character: { select: { id: true, targetId: true, name: true } } },
      },
    },
    orderBy: { updatedAt: sort === 'newest' ? 'desc' : 'asc' },
  });

  // Visibility: admin sees all; user only those they participated in
  const visibleTopics = isAdmin
    ? allTopics
    : allTopics.filter((t) => t.messages.some((m) => charIdSet.has(m.character.id)));

  const enriched = visibleTopics.map((t) => {
    const last = t.messages[t.messages.length - 1];
    const lastIsMine = last ? charIdSet.has(last.character.id) : false;
    const status = t.closed ? 'closed' : lastIsMine ? 'waiting' : 'needs_reply';
    return { ...t, status, lastIsMine, last };
  });

  const filtered = enriched.filter((t) => filter === 'all' || t.status === filter);

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
            <a href={`?filter=all&sort=${sort}`}><TabsTrigger value="all">Toutes ({counts.all})</TabsTrigger></a>
            <a href={`?filter=needs_reply&sort=${sort}`}><TabsTrigger value="needs_reply">🔴 À répondre ({counts.needs_reply})</TabsTrigger></a>
            <a href={`?filter=waiting&sort=${sort}`}><TabsTrigger value="waiting">🟡 En attente ({counts.waiting})</TabsTrigger></a>
            <a href={`?filter=closed&sort=${sort}`}><TabsTrigger value="closed">🔘 Clôturées ({counts.closed})</TabsTrigger></a>
          </TabsList>
        </Tabs>
        <a
          href={`?filter=${filter}&sort=${sort === 'newest' ? 'oldest' : 'newest'}`}
          className="ml-auto"
        >
          <Button variant="outline" size="sm">
            {sort === 'newest' ? '↓ Plus récentes d\'abord' : '↑ Plus anciennes d\'abord'}
          </Button>
        </a>
      </div>

      {filtered.length === 0 && (
        <p className="text-muted-foreground">Aucune missive {filter !== 'all' && `dans cette catégorie`}.</p>
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
                  {topic.last?.date || '—'}
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
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Voir les {topic.messages.length} message{topic.messages.length > 1 ? 's' : ''}
                </summary>
                <div className="mt-3 space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {topic.messages.map((m) => {
                    const isMine = charIdSet.has(m.character.id);
                    return (
                      <div
                        key={m.id}
                        className={`p-3 rounded text-sm ${
                          isMine ? 'bg-blue-50 ml-8' : 'bg-gray-50 mr-8'
                        }`}
                      >
                        <div className="text-xs font-medium mb-1 flex justify-between">
                          <span>{m.character.name}</span>
                          <span className="text-muted-foreground">{m.date}</span>
                        </div>
                        <div
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: sanitizeForumHtml(m.content) }}
                        />
                      </div>
                    );
                  })}
                </div>
              </details>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
