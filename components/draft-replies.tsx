"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DraftState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; character: string; drafts: string[] };

export function DraftReplies({ topicId }: { topicId: number }) {
  const [state, setState] = useState<DraftState>({ status: "idle" });
  const [instructions, setInstructions] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function generate() {
    setState({ status: "loading" });
    setCopiedIndex(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId,
          instructions: instructions.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: data.error || `Erreur ${res.status}` });
        return;
      }
      setState({ status: "done", character: data.character, drafts: data.drafts });
    } catch {
      setState({ status: "error", message: "Erreur réseau" });
    }
  }

  async function copy(text: string, index: number) {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Consigne (optionnel) : ex. « décliner poliment », « proposer un rendez-vous »…"
          className="h-8 max-w-md text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={generate}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "✒️ Rédaction en cours…" : "✒️ Proposer des réponses"}
        </Button>
      </div>

      {state.status === "error" && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}

      {state.status === "done" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Brouillons dans la voix de {state.character} — à relire avant d'envoyer.
          </p>
          {state.drafts.map((draft, i) => (
            <div key={i} className="rounded border bg-amber-50/50 p-3 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Brouillon {i + 1}
                </span>
                <Button variant="ghost" size="sm" onClick={() => copy(draft, i)}>
                  {copiedIndex === i ? "✓ Copié" : "Copier"}
                </Button>
              </div>
              <div className="whitespace-pre-wrap">{draft}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
