'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { QuestMissive } from '@/components/quest-missive';
import { QuestEnrich } from '@/components/quest-enrich';
import { DictatedTextarea, DictationButton } from '@/components/dictation';
import {
  CHANNEL_LABEL,
  OPEN_STATUSES,
  QUEST_STATUSES,
  QUEST_STATUS_COLOR,
  QUEST_STATUS_HINT,
  QUEST_STATUS_LABEL,
  type QuestChannel,
  type QuestStatus,
  type QuestView,
} from '@/lib/questStatus';

export type TopicOption = {
  topicId: number;
  name: string;
  channel: QuestChannel;
  lastLabel: string;
  involved: boolean;
};

export type CharacterOption = { targetId: number; name: string };

type ActorDraft = { targetId: number | null; name: string; role: string };

/** Une ancre : le message précis qui porte la preuve de l'intrigue. */
type AnchorDraft = {
  messageId: number;
  dateLabel: string;
  author: string;
  topicName: string;
  excerpt: string;
};

type QuestDraft = {
  title: string;
  summary: string;
  stake: string;
  nextStep: string;
  status: QuestStatus;
  topicIds: number[];
  actors: ActorDraft[];
  anchors: AnchorDraft[];
};

type Candidate = {
  title: string;
  summary: string;
  looseEnd: string;
  stake: string;
  nextStep: string;
  status: QuestStatus;
  topicIds: number[];
  topics: { topicId: number; name: string; channel: QuestChannel; involved: boolean; silentDays: number }[];
  messageIds: number[];
  anchors: { messageId: number; topicId: number; topicName: string }[];
  actors: CharacterOption[];
  unknownActors: string[];
};

type DetectState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; candidates: Candidate[]; threadsRead: number };

type ComposeState = { status: 'idle' | 'loading' } | { status: 'error'; message: string };

const emptyDraft: QuestDraft = {
  title: '',
  summary: '',
  stake: '',
  nextStep: '',
  status: 'lead',
  topicIds: [],
  actors: [],
  anchors: [],
};

function draftFromQuest(quest: QuestView): QuestDraft {
  return {
    title: quest.title,
    summary: quest.summary ?? '',
    stake: quest.stake ?? '',
    nextStep: quest.nextStep ?? '',
    status: quest.status,
    topicIds: quest.topics.map((t) => t.topicId),
    actors: quest.actors.map((a) => ({ targetId: a.targetId, name: a.name, role: a.role ?? '' })),
    anchors: quest.anchors.map((a) => ({
      messageId: a.messageId,
      dateLabel: a.dateLabel,
      author: a.author,
      topicName: a.topicName,
      excerpt: a.excerpt,
    })),
  };
}

const labelClass = 'text-xs font-medium text-muted-foreground';
const fieldClass =
  'w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring';

export function QuestBoard({
  character,
  quests,
  topicOptions,
  characterOptions,
}: {
  character: CharacterOption;
  quests: QuestView[];
  topicOptions: TopicOption[];
  characterOptions: CharacterOption[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<'open' | 'all' | QuestStatus>('open');
  const [detect, setDetect] = useState<DetectState>({ status: 'idle' });
  const [instructions, setInstructions] = useState('');
  const [creating, setCreating] = useState(false);
  const [dictation, setDictation] = useState('');
  const [compose, setCompose] = useState<ComposeState>({ status: 'idle' });
  // Le formulaire garde son brouillon dans un état local : pour qu'une dictée
  // vienne le remplir, il faut le remonter.
  const [formDraft, setFormDraft] = useState<QuestDraft>(emptyDraft);
  const [formKey, setFormKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const topicById = useMemo(
    () => new Map(topicOptions.map((t) => [t.topicId, t])),
    [topicOptions]
  );

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(QUEST_STATUSES.map((s) => [s, 0])) as Record<QuestStatus, number>;
    for (const quest of quests) byStatus[quest.status] += 1;
    return {
      ...byStatus,
      all: quests.length,
      open: quests.filter((q) => OPEN_STATUSES.includes(q.status)).length,
    };
  }, [quests]);

  const visible = quests.filter((quest) =>
    filter === 'all' ? true : filter === 'open' ? OPEN_STATUSES.includes(quest.status) : quest.status === filter
  );

  async function call(url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Erreur ${res.status}`);
        return null;
      }
      // Un nom cité sans fiche en base n'est pas rattaché : le dire plutôt que
      // de le laisser disparaître silencieusement du formulaire.
      setNotice(
        Array.isArray(data.unknownActors) && data.unknownActors.length > 0
          ? `Non rattachés, aucune fiche à ce nom en base : ${data.unknownActors.join(', ')}`
          : null
      );
      router.refresh();
      return data;
    } catch {
      setError('Erreur réseau');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createQuest(draft: QuestDraft, origin: 'manual' | 'ai') {
    const created = await call('/api/quests', {
      method: 'POST',
      body: JSON.stringify({
        characterTargetId: character.targetId,
        ...draft,
        origin,
        messageIds: draft.anchors.map((a) => a.messageId),
        actors: draft.actors.map((a) => ({ targetId: a.targetId ?? undefined, name: a.name, role: a.role })),
      }),
    });
    return created !== null;
  }

  async function runDetection() {
    setDetect({ status: 'loading' });
    setError(null);
    try {
      const res = await fetch('/api/quests/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterTargetId: character.targetId,
          instructions: instructions.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDetect({ status: 'error', message: data.error || `Erreur ${res.status}` });
        return;
      }
      setDetect({ status: 'done', candidates: data.candidates, threadsRead: data.threadsRead });
    } catch {
      setDetect({ status: 'error', message: 'Erreur réseau' });
    }
  }

  /** Dictée en clair : le modèle range, l'auteur relit et corrige avant d'enregistrer. */
  async function composeFromDictation() {
    const text = dictation.trim();
    if (text.length < 10) {
      setCompose({ status: 'error', message: 'Décrivez la quête en quelques mots au moins' });
      return;
    }
    setCompose({ status: 'loading' });
    try {
      const res = await fetch('/api/quests/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterTargetId: character.targetId, text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompose({ status: 'error', message: data.error || `Erreur ${res.status}` });
        return;
      }
      setFormDraft({
        title: data.draft.title ?? '',
        summary: data.draft.summary ?? '',
        stake: data.draft.stake ?? '',
        nextStep: data.draft.nextStep ?? '',
        status: data.draft.status ?? 'lead',
        topicIds: data.draft.topicIds ?? [],
        actors: (data.draft.actors ?? []).map((a: CharacterOption) => ({
          targetId: a.targetId,
          name: a.name,
          role: '',
        })),
        anchors: [],
      });
      setFormKey((key) => key + 1);
      setCompose({ status: 'idle' });
      setNotice(
        Array.isArray(data.unknownActors) && data.unknownActors.length > 0
          ? `Non rattachés, aucune fiche à ce nom en base : ${data.unknownActors.join(', ')}`
          : null
      );
    } catch {
      setCompose({ status: 'error', message: 'Erreur réseau' });
    }
  }

  function openCreation() {
    setFormDraft(emptyDraft);
    setFormKey((key) => key + 1);
    setDictation('');
    setCompose({ status: 'idle' });
    setCreating(true);
    setEditingId(null);
  }

  function dropCandidate(index: number) {
    setDetect((state) =>
      state.status === 'done'
        ? { ...state, candidates: state.candidates.filter((_, i) => i !== index) }
        : state
    );
  }

  async function acceptCandidate(candidate: Candidate, index: number) {
    const ok = await createQuest(
      {
        title: candidate.title,
        summary: candidate.summary,
        stake: candidate.stake,
        nextStep: candidate.nextStep,
        status: candidate.status,
        topicIds: candidate.topicIds,
        actors: candidate.actors.map((a) => ({ targetId: a.targetId, name: a.name, role: '' })),
        anchors: (candidate.anchors ?? []).map((a) => ({
          messageId: a.messageId,
          dateLabel: '',
          author: '',
          topicName: a.topicName,
          excerpt: '',
        })),
      },
      'ai'
    );
    if (ok) dropCandidate(index);
  }

  const filterTabs: { key: 'open' | 'all' | QuestStatus; label: string; count: number }[] = [
    { key: 'open', label: 'En cours', count: counts.open },
    ...OPEN_STATUSES.map((s) => ({ key: s, label: QUEST_STATUS_LABEL[s], count: counts[s] })),
    { key: 'closed', label: QUEST_STATUS_LABEL.closed, count: counts.closed },
    { key: 'dismissed', label: QUEST_STATUS_LABEL.dismissed, count: counts.dismissed },
    { key: 'all', label: 'Toutes', count: counts.all },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              filter === tab.key
                ? 'border-transparent bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (creating ? setCreating(false) : openCreation())}
          >
            {creating ? 'Annuler' : '+ Nouvelle quête'}
          </Button>
          <Button variant="outline" size="sm" onClick={runDetection} disabled={detect.status === 'loading'}>
            {detect.status === 'loading' ? '🔎 Lecture des fils…' : '🔎 Détecter les intrigues'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Consigne de détection (optionnel) : ex. « uniquement les dettes et promesses »"
          className="h-8 max-w-xl text-xs"
        />
        <DictationButton value={instructions} onChange={setInstructions} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-orange-600">{notice}</p>}
      {detect.status === 'error' && <p className="text-sm text-red-600">{detect.message}</p>}

      {creating && (
        <Card>
          <CardHeader className="pb-2 text-sm font-semibold">Nouvelle quête</CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded border border-dashed bg-muted/30 p-3">
              <label className={labelClass}>Dictez-la en clair, les champs se remplissent ensuite</label>
              <DictatedTextarea
                className={`${fieldClass} mt-1 min-h-24`}
                value={dictation}
                onChange={setDictation}
                placeholder="Ex. : « Ça fait des mois que je cherche Zeus. Memestra a laissé tomber, il me reste la piste de Leyrion sur le disque solaire. Je dois lui réécrire. »"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={composeFromDictation}
                  disabled={compose.status === 'loading'}
                >
                  {compose.status === 'loading' ? '✍️ Mise en fiche…' : '✍️ Remplir les champs'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Rien n&apos;est enregistré : les champs ci-dessous restent modifiables.
                </span>
              </div>
              {compose.status === 'error' && (
                <p className="mt-2 text-sm text-red-600">{compose.message}</p>
              )}
            </div>

            <QuestForm
              key={formKey}
              initial={formDraft}
              topicOptions={topicOptions}
              characterOptions={characterOptions}
              busy={busy}
              submitLabel="Créer la quête"
              onCancel={() => setCreating(false)}
              onSubmit={async (draft) => {
                if (await createQuest(draft, 'manual')) setCreating(false);
              }}
            />
          </CardContent>
        </Card>
      )}

      {detect.status === 'done' && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">
                Intrigues proposées ({detect.candidates.length})
              </span>
              <span className="text-xs text-muted-foreground">
                {detect.threadsRead} fils relus · rien n&apos;est enregistré tant que vous n&apos;avez pas
                accepté
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {detect.candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Aucune intrigue en suspens repérée dans les fils relus.
              </p>
            )}
            {detect.candidates.map((candidate, index) => (
              <div key={`${candidate.title}-${index}`} className="rounded border bg-amber-50/50 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="font-medium">
                    <span
                      className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${QUEST_STATUS_COLOR[candidate.status]}`}
                    >
                      {QUEST_STATUS_LABEL[candidate.status]}
                    </span>
                    {candidate.title}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => acceptCandidate(candidate, index)}>
                      Ajouter au carnet
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dropCandidate(index)}>
                      Écarter
                    </Button>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{candidate.summary}</p>
                <p className="mt-2 text-xs">
                  <span className={labelClass}>En suspens : </span>
                  {candidate.looseEnd}
                </p>
                <p className="mt-1 text-xs">
                  <span className={labelClass}>Enjeu : </span>
                  {candidate.stake}
                </p>
                <p className="mt-1 text-xs">
                  <span className={labelClass}>Prochaine action : </span>
                  {candidate.nextStep}
                </p>
                <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
                  {candidate.topics.map((topic) => (
                    <span key={topic.topicId} className="rounded border px-1.5 py-0.5">
                      {CHANNEL_LABEL[topic.channel]} · {topic.name}
                      {!topic.involved && ' · jamais intervenue'}
                    </span>
                  ))}
                  {candidate.actors.map((actor) => (
                    <span key={actor.targetId} className="rounded bg-muted px-1.5 py-0.5">
                      {actor.name}
                    </span>
                  ))}
                </div>
                {candidate.anchors?.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Trace conservée : {candidate.anchors.length} message
                    {candidate.anchors.length > 1 ? 's' : ''} ({' '}
                    {candidate.anchors.map((a) => a.topicName).join(', ')} )
                  </p>
                )}
                {candidate.unknownActors.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Noms cités sans fiche en base, non rattachés : {candidate.unknownActors.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {visible.length === 0 && (
        <p className="text-muted-foreground">
          Aucune quête dans cette vue. Lancez une détection ou créez-en une à la main.
        </p>
      )}

      <div className="space-y-3">
        {visible.map((quest) =>
          editingId === quest.id ? (
            <Card key={quest.id}>
              <CardHeader className="pb-2 text-sm font-semibold">Modifier : {quest.title}</CardHeader>
              <CardContent>
                <QuestForm
                  initial={draftFromQuest(quest)}
                  topicOptions={topicOptions}
                  characterOptions={characterOptions}
                  busy={busy}
                  submitLabel="Enregistrer"
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (draft) => {
                    const saved = await call(`/api/quests/${quest.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        ...draft,
                        messageIds: draft.anchors.map((a) => a.messageId),
                        actors: draft.actors.map((a) => ({
                          targetId: a.targetId ?? undefined,
                          name: a.name,
                          role: a.role,
                        })),
                      }),
                    });
                    if (saved) setEditingId(null);
                  }}
                />
              </CardContent>
            </Card>
          ) : (
            <QuestCard
              key={quest.id}
              quest={quest}
              busy={busy}
              topicById={topicById}
              onEdit={() => {
                setEditingId(quest.id);
                setCreating(false);
              }}
              onStatus={(status) =>
                call(`/api/quests/${quest.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
              }
              onDelete={() => call(`/api/quests/${quest.id}`, { method: 'DELETE' })}
              onRefresh={() => router.refresh()}
            />
          )
        )}
      </div>
    </div>
  );
}

function QuestCard({
  quest,
  busy,
  topicById,
  onEdit,
  onStatus,
  onDelete,
  onRefresh,
}: {
  quest: QuestView;
  busy: boolean;
  topicById: Map<number, TopicOption>;
  onEdit: () => void;
  onStatus: (status: QuestStatus) => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Le carnet se lit d'abord de haut : titre, statut, ce qui se joue, ce qu'il
  // reste à faire. Les fils, les acteurs et la trace sont le dossier derrière,
  // qu'on ouvre quête par quête. Replié par défaut : à dix quêtes ouvertes,
  // tout déplier ne se lit plus.
  const [open, setOpen] = useState(false);

  // Une quête engagée dont les fils se sont tus depuis longtemps est le vrai
  // signal du carnet : c'est là qu'une relance se perd.
  const stale = quest.staleDays !== null && quest.staleDays >= 14 && quest.status !== 'closed';

  const detailCount = [
    quest.topics.length > 0 && `${quest.topics.length} fil${quest.topics.length > 1 ? 's' : ''}`,
    quest.actors.length > 0 && `${quest.actors.length} acteur${quest.actors.length > 1 ? 's' : ''}`,
    quest.anchors.length > 0 &&
      `${quest.anchors.length} trace${quest.anchors.length > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-2">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-controls={`quest-details-${quest.id}`}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="text-xs text-muted-foreground">
              {open ? '▾' : '▸'}
            </span>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${QUEST_STATUS_COLOR[quest.status]}`}
            >
              {QUEST_STATUS_LABEL[quest.status]}
            </span>
            <span className="font-semibold">{quest.title}</span>
            {quest.origin === 'ai' && (
              <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                détectée
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {quest.topics.length} fil{quest.topics.length > 1 ? 's' : ''} ·{' '}
            {quest.staleDays === null
              ? 'aucun fil rattaché'
              : `dernier mouvement le ${quest.lastLabel} (${quest.staleDays} j)`}
            {stale && <span className="ml-1 text-orange-600">· en sommeil</span>}
          </p>
        </button>
        <select
          value={quest.status}
          disabled={busy}
          onChange={(e) => onStatus(e.target.value as QuestStatus)}
          className="h-8 rounded border bg-background px-2 text-xs"
          title={QUEST_STATUS_HINT[quest.status]}
        >
          {QUEST_STATUSES.map((status) => (
            <option key={status} value={status}>
              {QUEST_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {quest.summary && <p className="whitespace-pre-wrap">{quest.summary}</p>}
        {quest.stake && (
          <p className="text-sm">
            <span className={labelClass}>Enjeu : </span>
            {quest.stake}
          </p>
        )}
        {quest.nextStep && (
          <p className="rounded border-l-2 border-foreground/30 bg-muted/50 px-2 py-1 text-sm">
            <span className={labelClass}>Prochaine action : </span>
            {quest.nextStep}
          </p>
        )}

        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={false}
            aria-controls={`quest-details-${quest.id}`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            ▸ Le dossier{detailCount && ` : ${detailCount}`}
          </button>
        )}
      </CardContent>

      <CardContent
        id={`quest-details-${quest.id}`}
        hidden={!open}
        className="space-y-2 border-t pt-3 text-sm"
      >
        {quest.topics.length > 0 && (
          <ul className="space-y-1 text-xs">
            {quest.topics.map((topic) => (
              <li key={topic.topicId} className="flex flex-wrap items-baseline gap-2">
                <span className="rounded border px-1.5 py-0.5 text-muted-foreground">
                  {CHANNEL_LABEL[topic.channel]}
                </span>
                <a
                  href={topic.link}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {topic.name}
                </a>
                <span className="text-muted-foreground">
                  {topic.messageCount} msg · dernier : {topic.lastAuthor} le {topic.lastLabel}
                  {!topic.lastIsMine && topic.messageCount > 0 && ' · à vous de jouer'}
                  {!topicById.has(topic.topicId) && ' · fil hors de votre liste'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {quest.actors.length > 0 && (
          <div className="flex flex-wrap gap-1 text-xs">
            {quest.actors.map((actor) => (
              <span key={actor.targetId} className="rounded bg-muted px-1.5 py-0.5">
                {actor.name}
                {actor.role ? ` · ${actor.role}` : ''}
              </span>
            ))}
          </div>
        )}

        {quest.anchors.length > 0 && (
          <div className="space-y-1 border-l-2 pl-3">
            <p className={labelClass}>
              La trace ({quest.anchors.length} message{quest.anchors.length > 1 ? 's' : ''})
            </p>
            {quest.anchors.map((anchor) => (
              <div key={anchor.messageId} className="text-xs">
                <span className="font-medium">{anchor.dateLabel}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {anchor.author} ·{' '}
                  <a
                    href={anchor.link}
                    target="_blank"
                    rel="noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    {anchor.topicName}
                  </a>
                </span>
                <p className="italic text-muted-foreground">« {anchor.excerpt} »</p>
                {anchor.note && <p className="text-muted-foreground">{anchor.note}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          <QuestMissive
            questId={quest.id}
            actors={quest.actors.map((actor) => actor.name)}
            nextStep={quest.nextStep}
          />
          <QuestEnrich quest={quest} busy={busy} onApplied={onRefresh} />
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Modifier
          </Button>
          {confirming ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onDelete}
              className="text-red-600"
            >
              Confirmer
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              Supprimer
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function QuestForm({
  initial,
  topicOptions,
  characterOptions,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: QuestDraft;
  topicOptions: TopicOption[];
  characterOptions: CharacterOption[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (draft: QuestDraft) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<QuestDraft>(initial);
  const [actorName, setActorName] = useState('');
  const [actorRole, setActorRole] = useState('');

  const set = <K extends keyof QuestDraft>(key: K, value: QuestDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const selected = topicOptions.filter((t) => draft.topicIds.includes(t.topicId));
  const selectable = topicOptions.filter((t) => !draft.topicIds.includes(t.topicId));
  // Fils rattachés hors de la liste proposée (détectés ailleurs) : on les garde
  // sans les perdre à l'enregistrement.
  const foreignTopicIds = draft.topicIds.filter((id) => !topicOptions.some((t) => t.topicId === id));

  function addActor() {
    const name = actorName.trim();
    if (!name) return;
    const known = characterOptions.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (draft.actors.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
    set('actors', [
      ...draft.actors,
      { targetId: known?.targetId ?? null, name: known?.name ?? name, role: actorRole.trim() },
    ]);
    setActorName('');
    setActorRole('');
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>Titre</label>
        <input
          className={fieldClass}
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Ce que l'intrigue raconte, en une ligne"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className={labelClass}>L&apos;intrigue</label>
          <DictatedTextarea
            className={`${fieldClass} min-h-20`}
            value={draft.summary}
            onChange={(next) => set('summary', next)}
            placeholder="Les faits, et ce qui reste sans réponse"
          />
        </div>
        <div>
          <label className={labelClass}>Enjeu</label>
          <DictatedTextarea
            className={`${fieldClass} min-h-20`}
            value={draft.stake}
            onChange={(next) => set('stake', next)}
            placeholder="Pourquoi s'en mêler, ou pourquoi ça pourrait tenter"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div>
          <label className={labelClass}>Prochaine action</label>
          <input
            className={fieldClass}
            value={draft.nextStep}
            onChange={(e) => set('nextStep', e.target.value)}
            placeholder="Une action concrète : écrire à quelqu'un, se rendre quelque part…"
          />
        </div>
        <div>
          <label className={labelClass}>Statut</label>
          <select
            className={`${fieldClass} h-[34px]`}
            value={draft.status}
            onChange={(e) => set('status', e.target.value as QuestStatus)}
          >
            {QUEST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {QUEST_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{QUEST_STATUS_HINT[draft.status]}</p>

      <div>
        <label className={labelClass}>Fils rattachés</label>
        <div className="mb-1 flex flex-wrap gap-1">
          {selected.map((topic) => (
            <span key={topic.topicId} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
              {CHANNEL_LABEL[topic.channel]} · {topic.name}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => set('topicIds', draft.topicIds.filter((id) => id !== topic.topicId))}
              >
                ×
              </button>
            </span>
          ))}
          {foreignTopicIds.map((id) => (
            <span key={id} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
              Fil #{id}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => set('topicIds', draft.topicIds.filter((kept) => kept !== id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <select
          className={fieldClass}
          value=""
          onChange={(e) => {
            const id = parseInt(e.target.value, 10);
            if (!Number.isNaN(id)) set('topicIds', [...draft.topicIds, id]);
          }}
        >
          <option value="">Ajouter un fil…</option>
          {selectable.map((topic) => (
            <option key={topic.topicId} value={topic.topicId}>
              {CHANNEL_LABEL[topic.channel]} · {topic.name} ({topic.lastLabel})
              {topic.involved ? '' : ' [jamais intervenue]'}
            </option>
          ))}
        </select>
      </div>

      {draft.anchors.length > 0 && (
        <div>
          <label className={labelClass}>
            La trace : messages cités comme preuve (retirables, pas modifiables ici)
          </label>
          <div className="mt-1 space-y-1">
            {draft.anchors.map((anchor) => (
              <div
                key={anchor.messageId}
                className="flex items-start justify-between gap-2 rounded border px-2 py-1 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-medium">{anchor.dateLabel || `msg#${anchor.messageId}`}</span>
                  {anchor.author && <span className="text-muted-foreground"> · {anchor.author}</span>}
                  {anchor.topicName && (
                    <span className="text-muted-foreground"> · {anchor.topicName}</span>
                  )}
                  {anchor.excerpt && (
                    <p className="truncate italic text-muted-foreground">« {anchor.excerpt} »</p>
                  )}
                </div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    set('anchors', draft.anchors.filter((a) => a.messageId !== anchor.messageId))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className={labelClass}>Personnages impliqués</label>
        <div className="mb-1 flex flex-wrap gap-1">
          {draft.actors.map((actor) => (
            <span key={actor.name} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              {actor.name}
              {actor.role ? ` · ${actor.role}` : ''}
              {actor.targetId === null && ' (inconnu en base)'}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => set('actors', draft.actors.filter((a) => a.name !== actor.name))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${fieldClass} max-w-56`}
            list="quest-character-options"
            value={actorName}
            onChange={(e) => setActorName(e.target.value)}
            placeholder="Nom du personnage"
          />
          <input
            className={`${fieldClass} max-w-56`}
            value={actorRole}
            onChange={(e) => setActorRole(e.target.value)}
            placeholder="Rôle (commanditaire, témoin…)"
          />
          <Button type="button" size="sm" variant="outline" onClick={addActor}>
            Ajouter
          </Button>
        </div>
        <datalist id="quest-character-options">
          {characterOptions.map((c) => (
            <option key={c.targetId} value={c.name} />
          ))}
        </datalist>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !draft.title.trim()} onClick={() => onSubmit(draft)}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
