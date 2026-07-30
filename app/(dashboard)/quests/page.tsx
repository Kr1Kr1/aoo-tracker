import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getCallerContextFromCookies } from '@/lib/authContext';
import { listQuests, linkableTopics } from '@/lib/quests';
import { OPEN_STATUSES } from '@/lib/questStatus';
import { QuestBoard } from '@/components/quest-board';

interface PageProps {
  searchParams: Promise<{ center?: string }>;
}

export default async function QuestsPage({ searchParams }: PageProps) {
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
        <h1 className="text-2xl font-bold">Quêtes</h1>
        <p className="text-muted-foreground">
          Aucun personnage n&apos;est rattaché à ce compte : pas de carnet de quêtes à tenir.
        </p>
      </div>
    );
  }

  // Même ordre de préférence que /relations : le personnage demandé, celui de
  // la session, Medarda, puis le premier du compte.
  const center =
    mine.find((c) => c.targetId === requested) ||
    mine.find((c) => c.targetId === ctx.actingAsTargetId) ||
    mine.find((c) => c.name === 'Medarda') ||
    mine[0];

  const [quests, topicOptions, characterOptions] = await Promise.all([
    listQuests(center.id),
    linkableTopics(center.id),
    prisma.characters.findMany({
      select: { targetId: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const open = quests.filter((q) => OPEN_STATUSES.includes(q.status));
  const sleeping = open.filter((q) => q.staleDays !== null && q.staleDays >= 14);
  const toPlay = open.filter((q) => q.status === 'engaged');

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Quêtes de {center.name}</h1>
        {mine.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">Carnet de</span>
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
        Les histoires qui n&apos;ont pas trouvé de fin, et où {center.name} est impliquée ou pourrait
        vouloir l&apos;être. {open.length} en cours, dont {toPlay.length} où la balle est dans son camp
        et {sleeping.length} en sommeil depuis plus de deux semaines. La détection relit les fils
        récents et propose : rien n&apos;entre au carnet sans validation.
      </p>

      <QuestBoard
        character={{ targetId: center.targetId, name: center.name }}
        quests={quests}
        topicOptions={topicOptions}
        characterOptions={characterOptions}
      />
    </div>
  );
}
