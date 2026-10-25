'use client';

// Dicter au lieu de taper.
//
// S'appuie sur la reconnaissance vocale du navigateur (Web Speech API) : rien
// ne transite par notre serveur, aucune clé à gérer, mais seuls Chrome, Edge et
// Safari la proposent (Firefox non). Le texte dicté vient à la suite de ce qui
// est déjà écrit ; tant qu'on parle, la fin encore incertaine se corrige en
// place. Chrome coupe de lui-même après quelques secondes de silence : on
// repart aussitôt, jusqu'à ce qu'on appuie sur stop.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

// lib.dom ne déclare pas SpeechRecognition (API préfixée) : le strict nécessaire.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionEvent = { results: ArrayLike<SpeechRecognitionResult> };

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Colle le dicté à la suite du texte existant, avec une majuscule si on part de rien. */
function append(base: string, spoken: string) {
  const text = spoken.trim();
  if (!text) return base;
  const trimmed = base.trimEnd();
  if (!trimmed) return text.charAt(0).toLocaleUpperCase('fr') + text.slice(1);
  return `${trimmed}${/\n$/.test(base) ? '\n' : ' '}${text}`;
}

const ERROR_LABEL: Record<string, string> = {
  'not-allowed': 'Micro refusé par le navigateur',
  'service-not-allowed': 'Micro refusé par le navigateur',
  'audio-capture': 'Aucun micro détecté',
  network: 'Reconnaissance vocale indisponible (réseau)',
};

export type Dictation = {
  supported: boolean | null; // null tant qu'on ne sait pas (rendu serveur)
  listening: boolean;
  error: string | null;
  toggle: () => void;
};

export function useDictation({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): Dictation {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const wantedRef = useRef(false); // vrai tant qu'on n'a pas appuyé sur stop
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

  useEffect(
    () => () => {
      wantedRef.current = false;
      recRef.current?.abort();
    },
    []
  );

  const stop = useCallback(() => {
    wantedRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;

    // Texte du champ au moment où l'on parle : le dicté s'y ajoute, jamais ne l'écrase.
    let base = valueRef.current;
    let finals = '';

    rec.onresult = (event) => {
      finals = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const piece = ` ${result[0].transcript.trim()}`;
        if (result.isFinal) finals += piece;
        else interim += piece;
      }
      onChangeRef.current(append(base, finals + interim));
    };

    rec.onerror = (event) => {
      // 'no-speech' et 'aborted' sont des fins de session normales, onend suit.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(ERROR_LABEL[event.error] ?? `Dictée interrompue (${event.error})`);
      wantedRef.current = false;
    };

    rec.onend = () => {
      if (!wantedRef.current || recRef.current !== rec) {
        setListening(false);
        return;
      }
      // Coupure automatique du navigateur : on fige ce qui est acquis et on repart.
      base = append(base, finals);
      finals = '';
      try {
        rec.start();
      } catch {
        wantedRef.current = false;
        setListening(false);
      }
    };

    recRef.current = rec;
    wantedRef.current = true;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('Impossible de démarrer la dictée');
      wantedRef.current = false;
      recRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    if (wantedRef.current) stop();
    else start();
  }, [start, stop]);

  return { supported, listening, error, toggle };
}

/** Le bouton micro seul : à poser à côté d'un champ dont on tient déjà la dictée. */
export function MicButton({ dictation, className }: { dictation: Dictation; className?: string }) {
  const title =
    dictation.supported === false
      ? 'Dictée non prise en charge par ce navigateur (Chrome, Edge ou Safari)'
      : dictation.listening
        ? 'Arrêter la dictée'
        : 'Dicter';
  return (
    <button
      type="button"
      onClick={dictation.toggle}
      disabled={dictation.supported !== true}
      title={title}
      aria-label={title}
      aria-pressed={dictation.listening}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-background transition-colors',
        dictation.listening
          ? 'animate-pulse border-red-500 bg-red-500 text-white hover:bg-red-600'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
    >
      {dictation.listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Micro autonome pour un champ court (une consigne, un titre). */
export function DictationButton({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const dictation = useDictation({ value, onChange });
  return (
    <span className="inline-flex items-center gap-2">
      <MicButton dictation={dictation} className={className} />
      {dictation.error && <span className="text-xs text-red-600">{dictation.error}</span>}
    </span>
  );
}

/** Une zone de texte avec son micro dans le coin. */
export function DictatedTextarea({
  value,
  onChange,
  className,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (next: string) => void;
}) {
  const dictation = useDictation({ value, onChange });
  return (
    <div className="space-y-1">
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(className, 'pr-10', dictation.listening && 'ring-1 ring-red-400')}
          {...props}
        />
        <MicButton dictation={dictation} className="absolute right-2 top-2" />
      </div>
      {dictation.error && <p className="text-xs text-red-600">{dictation.error}</p>}
    </div>
  );
}
