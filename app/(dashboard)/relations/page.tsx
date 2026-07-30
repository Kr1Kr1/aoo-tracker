import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getCallerContextFromCookies } from '@/lib/authContext';
import { buildRelationGraph } from '@/lib/relations';
import { RelationGraph } from '@/components/relation-graph';

interface PageProps {
  searchParams: Promise<{ center?: string }>;
}

export default async function RelationsPage({ searchParams }: PageProps) {
  const ctx = await getCallerContextFromCookies();
  if (!ctx) redirect('/login');

  const params = await searchParams;
  const requested = parseInt(params.center || '', 10);

  const mine = await prisma.characters.findMany({
    where: { id: { in: ctx.characterIds } },
    select: { id: true, targetId: true, name: true },
    orderBy: { name: 'asc' },
  });

  if (mine.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <h1 className="text-2xl font-bold">Relations</h1>
        <p className="text-muted-foreground">
          Aucun personnage n&apos;est rattaché à ce compte : rien à mettre en relation.
        </p>
      </div>
    );
  }

  // Medarda by default, then whoever the session acts as, then the first
  // character of the account.
  const center =
    mine.find((c) => c.targetId === requested) ||
    mine.find((c) => c.targetId === ctx.actingAsTargetId) ||
    mine.find((c) => c.name === 'Medarda') ||
    mine[0];

  const graph = await buildRelationGraph(center.id);
  if (!graph) redirect('/relations');

  const exchanges = graph.contacts.reduce(
    (sum, c) => sum + c.missives + c.forum + c.hrp + c.events,
    0
  );

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Relations de {graph.center.name}</h1>
        {mine.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">Centrer sur</span>
            {mine.map((character) => (
              <a key={character.targetId} href={`?center=${character.targetId}`}>
                <span
                  className={`rounded border px-2 py-0.5 transition-colors ${
                    character.id === center.id
                      ? 'border-transparent bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {character.name}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {graph.contacts.length} personnages croisés · {exchanges} échanges cumulés ·{' '}
        {graph.topicCount} sujets partagés · {graph.eventCount} interactions dans le journal de jeu.
        Un lien = des messages dans les mêmes sujets ou une interaction en jeu.
      </p>

      <RelationGraph center={graph.center} contacts={graph.contacts} pairs={graph.pairs} />
    </div>
  );
}
