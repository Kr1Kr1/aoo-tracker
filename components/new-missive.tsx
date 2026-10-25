'use client';

// Ouvrir une missive depuis le tracker.
//
// Trois champs seulement, et un seul obligatoire : ce qu'on veut écrire. Le
// destinataire sert à retrouver la correspondance déjà eue avec lui, le titre à
// rapprocher les missives qui parlent de la même chose. Le ton, lui, ne se
// choisit pas : il est appris des vrais messages du personnage, côté serveur.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DictatedTextarea } from '@/components/dictation';

type Draft = { subject: string; body: string; angle: string };

type Context = {
  recipients: string[];
  unknownRecipients: string[];
  withRecipient: { name: string; lastLabel: string }[];
  related: { name: string; reason: string }[];
  scannedTopics: number;
};

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; character: string; drafts: Draft[]; voiceSamples: number; context: Context };

export function NewMissive({ correspondents }: { correspondents: string[] }) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [intent, setIntent] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  function toggleRecipient(name: string) {
    const names = recipient
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const already = names.some((entry) => entry.toLowerCase() === name.toLowerCase());
    const next = already
      ? names.filter((entry) => entry.toLowerCase() !== name.toLowerCase())
      : [...names, name];
    setRecipient(next.join(', '));
  }

  const chosen = new Set(
    recipient
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );

  async function write() {
    setState({ status: 'loading' });
    setCopiedIndex(null);
    try {
      const res = await fetch('/api/missives/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: recipient,
          subject: subject.trim() || undefined,
          intent: intent.trim(),
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
        context: data.context,
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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        ✍️ Nouvelle missive
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded border border-dashed bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Ouvrir une missive : la rédaction s&apos;appuie sur vos échanges passés avec le
          destinataire et sur les missives voisines.
        </span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Destinataire (séparés par des virgules)"
          className="h-8 text-xs sm:max-w-64"
        />
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Titre (optionnel : sinon il est proposé)"
          className="h-8 text-xs"
        />
      </div>

      {correspondents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {correspondents.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggleRecipient(name)}
              className={`rounded border px-1.5 py-0.5 text-xs transition-colors ${
                chosen.has(name.toLowerCase())
                  ? 'border-transparent bg-foreground text-background'
                  : 'hover:bg-muted'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <DictatedTextarea
        className="min-h-48 w-full resize-y rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        value={intent}
        onChange={setIntent}
        placeholder="Ce que vous voulez écrire : la demande, la nouvelle à annoncer, la proposition. En clair, sans soigner le style."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={write}
          disabled={state.status === 'loading' || intent.trim().length === 0}
        >
          {state.status === 'loading' ? '✒️ Rédaction en cours…' : '✒️ Écrire'}
        </Button>
        {intent.trim().length === 0 && (
          <span className="text-xs text-muted-foreground">
            Dites d&apos;abord ce que vous voulez écrire.
          </span>
        )}
      </div>

      {state.status === 'error' && <p className="text-sm text-red-600">{state.message}</p>}

      {state.status === 'done' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Brouillons dans la voix de {state.character}
            {state.voiceSamples > 0 && `, calquée sur ${state.voiceSamples} de ses messages`} : à
            relire avant d&apos;envoyer.
          </p>

          <ContextNote context={state.context} />

          {state.drafts.map((draft, index) => (
            <div key={index} className="rounded border bg-amber-50/50 p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{draft.subject}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => copy(draft.subject, -index - 1)}>
                    {copiedIndex === -index - 1 ? '✓ Titre copié' : 'Copier le titre'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => copy(draft.body, index)}>
                    {copiedIndex === index ? '✓ Copié' : 'Copier'}
                  </Button>
                </div>
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

/** Sur quoi la rédaction s'est appuyée : un brouillon qu'on ne sait pas sourcer ne se relit pas. */
function ContextNote({ context }: { context: Context }) {
  if (!context) return null;
  const parts: string[] = [];
  if (context.withRecipient.length) {
    parts.push(
      `${context.withRecipient.length} missive(s) échangée(s) avec le destinataire : ${context.withRecipient
        .map((t) => `« ${t.name} » (${t.lastLabel})`)
        .join(', ')}`
    );
  }
  if (context.related.length) {
    parts.push(
      `${context.related.length} missive(s) rapprochée(s) : ${context.related
        .map((t) => `« ${t.name} » (${t.reason})`)
        .join(', ')}`
    );
  }
  if (context.unknownRecipients.length) {
    parts.push(
      `aucune correspondance connue avec ${context.unknownRecipients.join(', ')} : première approche`
    );
  }
  if (parts.length === 0) return null;

  return (
    <p className="text-xs text-muted-foreground">
      Contexte lu ({context.scannedTopics} missives parcourues) : {parts.join(' · ')}.
    </p>
  );
}
