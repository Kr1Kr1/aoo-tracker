'use client';

// Écrire une missive depuis une quête, dans la voix du personnage.
//
// Deux façons de s'en servir, volontairement : cliquer et laisser la quête
// parler (la prochaine action notée au carnet fait l'intention), ou dire
// d'abord ce qu'on veut faire et cliquer ensuite. Le ton, lui, ne se choisit
// pas : il est appris des vrais messages du personnage côté serveur.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Draft = { subject: string; body: string; angle: string };

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; character: string; drafts: Draft[]; voiceSamples: number };

export function QuestMissive({
  questId,
  actors,
  nextStep,
}: {
  questId: number;
  actors: string[];
  nextStep: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [recipient, setRecipient] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function write() {
    setState({ status: 'loading' });
    setCopiedIndex(null);
    try {
      const res = await fetch(`/api/quests/${questId}/missive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: intent.trim() || undefined,
          recipient: recipient.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ status: 'error', message: data.error || `Erreur ${res.status}` });
        return;
      }
      setState({
        status: 'done',
        character: data.character,
        drafts: data.drafts,
        voiceSamples: data.voiceSamples ?? 0,
      });
    } catch {
      setState({ status: 'error', message: 'Erreur réseau' });
    }
  }

  async function copy(text: string, index: number) {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        ✍️ Écrire une missive
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded border border-dashed bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Missive à partir de cette quête
        </span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>

      <textarea
        className="min-h-16 w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        placeholder={
          nextStep
            ? `Ce que vous voulez faire (optionnel). Sans rien, la missive sert : « ${nextStep} »`
            : 'Ce que vous voulez faire (optionnel). Sans rien, la missive relance ce qui reste en suspens.'
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Destinataire (optionnel)"
          className="h-8 max-w-56 text-xs"
        />
        {actors.map((name) => (
          <button
            key={name}
            onClick={() => setRecipient(name)}
            className={`rounded border px-1.5 py-0.5 text-xs transition-colors ${
              recipient === name ? 'border-transparent bg-foreground text-background' : 'hover:bg-muted'
            }`}
          >
            {name}
          </button>
        ))}
        <Button size="sm" variant="outline" onClick={write} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? '✒️ Rédaction en cours…' : '✒️ Écrire'}
        </Button>
      </div>

      {state.status === 'error' && <p className="text-sm text-red-600">{state.message}</p>}

      {state.status === 'done' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Brouillons dans la voix de {state.character}
            {state.voiceSamples > 0 && `, calquée sur ${state.voiceSamples} de ses messages`} : à relire
            avant d&apos;envoyer.
          </p>
          {state.drafts.map((draft, index) => (
            <div key={index} className="rounded border bg-amber-50/50 p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{draft.subject}</span>
                <Button variant="ghost" size="sm" onClick={() => copy(draft.body, index)}>
                  {copiedIndex === index ? '✓ Copié' : 'Copier'}
                </Button>
              </div>
              {draft.angle && <p className="mb-2 text-xs text-muted-foreground">{draft.angle}</p>}
              <div className="whitespace-pre-wrap">{draft.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
