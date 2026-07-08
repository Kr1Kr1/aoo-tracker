// Draft-reply generation in a character's voice, via the local Claude Code
// CLI (ai-sdk-provider-claude-code) — no API key, uses the machine's
// authenticated `claude` session.

import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { generateObject } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";

const PROFILES_DIR = path.join(process.cwd(), "lib", "ai", "profiles");

export type TranscriptMessage = { author: string; date: string; text: string };

/** Voice profiles live in lib/ai/profiles/<slug>.md, keyed by character name. */
export async function loadVoiceProfile(characterName: string): Promise<string | null> {
  const slug = characterName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  try {
    return await readFile(path.join(PROFILES_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}

/** Forum messages are scraped innerHTML; flatten to plain text for the prompt. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

const DraftsSchema = z.object({
  drafts: z
    .array(z.string().min(1).describe("Corps du message, prêt à coller dans le jeu"))
    .min(1)
    .max(5),
});

export async function generateDraftReplies(opts: {
  characterName: string;
  profile: string;
  topicName: string;
  transcript: TranscriptMessage[];
  count?: number;
  instructions?: string;
}): Promise<string[]> {
  const count = Math.min(Math.max(opts.count ?? 3, 1), 5);
  const transcriptText = opts.transcript
    .map((m) => `--- ${m.author} (${m.date}) ---\n${m.text}`)
    .join("\n\n");

  const system = `Tu écris à la place de ${opts.characterName}, un personnage du jeu de rôle en ligne Age of Olympia.
Tu réponds au dernier message du fil en respectant scrupuleusement la voix du personnage décrite ci-dessous : registre, tics d'écriture, formules d'ouverture et de clôture, et surtout la relation entretenue avec l'interlocuteur (tutoiement/vouvoiement, surnoms, ton).
N'invente pas d'événements ou d'engagements majeurs qui ne découlent pas du fil.

${opts.profile}`;

  const prompt = `Fil : « ${opts.topicName} »

${transcriptText}

Propose ${count} brouillons de réponse distincts (angles ou tons différents) que ${opts.characterName} pourrait envoyer maintenant. Chaque brouillon est le corps du message uniquement, en français, prêt à coller dans le jeu.${
    opts.instructions ? `\n\nConsigne particulière de l'auteur : ${opts.instructions}` : ""
  }`;

  const { object } = await generateObject({
    model: claudeCode(process.env.AI_DRAFT_MODEL || "sonnet"),
    schema: DraftsSchema,
    system,
    prompt,
  });

  return object.drafts.slice(0, count);
}
