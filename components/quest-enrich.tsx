'use client';

// Relire tous les échanges pour étoffer une quête.
//
// Une quête saisie à la main ne contient que ce que l'auteur a tapé. Ce bouton
// relit ce que le compte peut lire (RP, forums privés, missives), reconstitue
// l'historique et propose une fiche à jour. Rien n'est appliqué sans un second
// clic : la proposition s'affiche d'abord, avec ce qu'elle apprend.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DictationButton } from '@/components/dictation';
import { QUEST_STATUS_LABEL, type QuestStatus, type QuestView } from '@/lib/questStatus';

type Proposal = {
  summary: string;
  stake: string;
  nextStep: string;
  status: QuestStatus;
  findings: string[];
  topicIds: number[];
  messageIds: number[];
  actors: { targetId: number; name: string; role: string }[];
  topics: { topicId: number; name: string; isNew: boolean }[];
  anchors: {
    messageId: number;
    topicName: string;
    author: string;
    date: string;
    excerpt: string;
    isNew: boolean;
  }[];
  unknownActors: string[];
};

type Scanned = { messages: number; topics: number };

/**
 * L'attente se joue en deux temps : la recherche dans le corpus, puis la
 * rédaction. Le serveur annonce la fin du premier (cf. la route enrich, qui
 * répond en NDJSON), ce que `progress` garde pour l'afficher pendant le second.
 */
type Progress = { scanned: Scanned; terms: string[]; threads: number };

type State =
  | { status: 'idle' }
  | { status: 'loading'; progress: Progress | null }
  | { status: 'error'; message: string }
  | { status: 'done'; proposal: Proposal | null; scanned: Scanned };

const labelClass = 'text-xs font-medium text-muted-foreground';

export function QuestEnrich({
  quest,
  busy,
  onApplied,
}: {
  quest: QuestView;
  busy: boolean;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [applying, setApplying] = useState(false);

  async function rescan() {
    setState({ status: 'loading', progress: null });
    try {
      const res = await fetch(`/api/quests/${quest.id}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: instructions.trim() || undefined }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setState({ status: 'error', message: data.error || `Erreur ${res.status}` });
        return;
      }

      // NDJSON : une ligne complète = un événement. On lit au fil de l'eau, en
      // gardant le reliquat entre deux morceaux, car rien ne garantit qu'un
      // chunk réseau s'arrête sur une fin de ligne.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let handled = false;

      const handle = (line: string) => {
        const event = JSON.parse(line);
        if (event.type === 'scanned') {
          setState({
            status: 'loading',
            progress: { scanned: event.scanned, terms: event.terms, threads: event.threads },
          });
        } else if (event.type === 'done') {
          handled = true;
          setState({ status: 'done', proposal: event.proposal, scanned: event.scanned });
        } else if (event.type === 'error') {
          handled = true;
          setState({ status: 'error', message: event.error || 'Erreur inconnue' });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf('\n');
        while (cut >= 0) {
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 1);
          if (line) handle(line);
          cut = buffer.indexOf('\n');
        }
      }
      const rest = buffer.trim();
      if (rest) handle(rest);

      // Flux coupé avant le mot de la fin : serveur redémarré, onglet en
      // veille, requête abandonnée. Le dire vaut mieux que laisser tourner.
      if (!handled) {
        setState({ status: 'error', message: 'Relecture interrompue avant la fin' });
      }
    } catch {
      setState({ status: 'error', message: 'Erreur réseau' });
    }
  }

  async function apply(proposal: Proposal) {
    setApplying(true);
    try {
      // PATCH remplace les listes : on fusionne avec l'existant plutôt que de
      // perdre un fil ou une ancre que la relecture n'aurait pas retrouvés.
      const topicIds = [...new Set([...quest.topics.map((t) => t.topicId), ...proposal.topicIds])];
      const messageIds = [
        ...new Set([...quest.anchors.map((a) => a.messageId), ...proposal.messageIds]),
      ];
      const actors = new Map<number, { targetId: number; name: string; role: string }>();
      for (const actor of quest.actors) {
        actors.set(actor.targetId, { targetId: actor.targetId, name: actor.name, role: actor.role ?? '' });
      }
      for (const actor of proposal.actors) {
        const existing = actors.get(actor.targetId);
        actors.set(actor.targetId, {
          targetId: actor.targetId,
          name: actor.name,
          // Le rôle relu complète, il n'écrase pas ce que l'auteur avait noté.
          role: existing?.role || actor.role,
        });
      }

      const res = await fetch(`/api/quests/${quest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: proposal.summary,
          stake: proposal.stake,
          nextStep: proposal.nextStep,
          status: proposal.status,
          topicIds,
          messageIds,
          actors: [...actors.values()],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState({ status: 'error', message: data.error || `Erreur ${res.status}` });
        return;
      }
      setState({ status: 'idle' });
      setOpen(false);
      onApplied();
    } catch {
      setState({ status: 'error', message: 'Erreur réseau' });
    } finally {
      setApplying(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        🔎 Relire les échanges
      </Button>
    );
  }

  return (
    // w-full : le panneau vit dans la rangée de boutons du dossier, en flex-wrap.
    // Sans ça, il se serre entre « Écrire une missive » et « Modifier » ; avec,
    // il prend sa propre ligne.
    <div className="mt-2 w-full space-y-3 rounded border border-dashed bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Relire RP, forums privés et missives à la recherche de cette quête
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Consigne (optionnel) : ex. « concentre-toi sur ce que disent les nains »"
          className="h-8 max-w-md text-xs"
        />
        <DictationButton value={instructions} onChange={setInstructions} />
        <Button size="sm" variant="outline" onClick={rescan} disabled={state.status === 'loading'}>
          {state.status === 'loading'
            ? state.progress
              ? '✍️ Rédaction en cours…'
              : '🔎 Lecture des échanges…'
            : '🔎 Relire'}
        </Button>
      </div>

      {state.status === 'loading' && (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {state.progress
            ? `${state.progress.scanned.messages} messages relus dans ${state.progress.scanned.topics} fils, ` +
              `${state.progress.threads} retenu${state.progress.threads > 1 ? 's' : ''} : ` +
              'le modèle rédige la fiche, comptez une à deux minutes.'
            : 'Recherche dans les RP, forums privés et missives lisibles par le compte…'}
        </p>
      )}

      {state.status === 'loading' && state.progress && state.progress.terms.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Recherche menée sur : {state.progress.terms.join(', ')}.
        </p>
      )}

      {state.status === 'error' && <p className="text-sm text-red-600">{state.message}</p>}

      {state.status === 'done' && !state.proposal && (
        <p className="text-sm text-muted-foreground">
          {state.scanned.messages} messages relus : rien qui parle de cette quête. Étoffez le titre ou le
          résumé, la recherche part de leurs mots.
        </p>
      )}

      {state.status === 'done' && state.proposal && (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {state.scanned.messages} messages relus dans {state.scanned.topics} fils. Rien n&apos;est
            enregistré tant que vous n&apos;avez pas appliqué.
          </p>

          {state.proposal.findings.length > 0 && (
            <div>
              <p className={labelClass}>Ce que la relecture apprend</p>
              <ul className="ml-4 list-disc space-y-0.5 text-sm">
                {state.proposal.findings.map((finding, index) => (
                  <li key={index}>{finding}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className={labelClass}>Résumé proposé ({QUEST_STATUS_LABEL[state.proposal.status]})</p>
            <p className="whitespace-pre-wrap">{state.proposal.summary}</p>
          </div>

          {state.proposal.stake && (
            <p>
              <span className={labelClass}>Enjeu : </span>
              {state.proposal.stake}
            </p>
          )}
          {state.proposal.nextStep && (
            <p>
              <span className={labelClass}>Prochaine action : </span>
              {state.proposal.nextStep}
            </p>
          )}

          <div className="flex flex-wrap gap-1 text-xs">
            {state.proposal.actors.map((actor) => (
              <span key={actor.targetId} className="rounded bg-muted px-1.5 py-0.5">
                {actor.name}
                {actor.role ? ` · ${actor.role}` : ''}
              </span>
            ))}
            {state.proposal.topics.map((topic) => (
              <span
                key={topic.topicId}
                className={`rounded border px-1.5 py-0.5 ${topic.isNew ? 'border-emerald-500 text-emerald-700' : 'text-muted-foreground'}`}
              >
                {topic.name}
                {topic.isNew && ' · nouveau'}
              </span>
            ))}
          </div>

          {state.proposal.anchors.length > 0 && (
            <div className="space-y-1 border-l-2 pl-3">
              <p className={labelClass}>
                Trace proposée ({state.proposal.anchors.filter((a) => a.isNew).length} nouvelle
                {state.proposal.anchors.filter((a) => a.isNew).length > 1 ? 's' : ''} sur{' '}
                {state.proposal.anchors.length})
              </p>
              {state.proposal.anchors.map((anchor) => (
                <div key={anchor.messageId} className="text-xs">
                  <span className="font-medium">{anchor.date}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {anchor.author} · {anchor.topicName}
                  </span>
                  <p className="italic text-muted-foreground">« {anchor.excerpt} »</p>
                </div>
              ))}
            </div>
          )}

          {state.proposal.unknownActors.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Noms cités sans fiche en base, non rattachés : {state.proposal.unknownActors.join(', ')}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || applying}
              onClick={() => apply(state.proposal!)}
            >
              {applying ? 'Application…' : 'Appliquer au carnet'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState({ status: 'idle' })}>
              Ignorer
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Appliquer remplace résumé, enjeu, prochaine action et statut ; les fils, ancres et acteurs
            déjà au carnet sont conservés et complétés.
          </p>
        </div>
      )}
    </div>
  );
}
