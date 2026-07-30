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
  /** Recent real messages by the same character, as a style anchor. */
  recentSamples?: string[];
  count?: number;
  instructions?: string;
}): Promise<string[]> {
  const count = Math.min(Math.max(opts.count ?? 3, 1), 5);
  const transcriptText = opts.transcript
    .map((m) => `--- ${m.author} (${m.date}) ---\n${m.text}`)
    .join("\n\n");

  // The written profile describes the voice; these are the voice. Recent real
  // messages catch the register drift a static profile misses.
  const samples = (opts.recentSamples || []).filter((s) => s.trim().length > 40);
  const samplesBlock = samples.length
    ? `\n\n---\n\n# MESSAGES RÉCENTS ÉCRITS PAR ${opts.characterName.toUpperCase()} (même contexte, verbatim)

Calque la longueur, le débit et le niveau de langue de ces messages avant tout le reste.

${samples.map((s, i) => `## Exemple ${i + 1}\n${s}`).join("\n\n")}`
    : "";

  const system = `Tu écris à la place de ${opts.characterName}, un personnage du jeu de rôle en ligne Age of Olympia.
Tu réponds au dernier message du fil en respectant scrupuleusement la voix du personnage décrite ci-dessous : registre, tics d'écriture, formules d'ouverture et de clôture, et surtout la relation entretenue avec l'interlocuteur (tutoiement/vouvoiement, surnoms, ton).

Trois règles qui priment sur l'envie de bien écrire :
1. **N'invente rien.** Ni événement, ni engagement, ni rendez-vous, ni objet, ni règle de jeu. Tout ce que tu nommes doit venir du fil, du profil ci-dessous, ou rester volontairement vague. Un objet d'équipement inventé ou une mécanique de jeu approximative est l'erreur la plus grave possible.
2. **Ne délaye pas.** Si la réponse utile tient en cinq lignes, elle tient en cinq lignes. Ajouter un paragraphe pour faire chaleureux dénature la voix.
3. **Pas de familiarité orale moderne** ni de vanne plaquée : reste dans le niveau de langue des messages réels du personnage.

Avant de rendre un brouillon, relis-le et supprime : toute expression que tu ne trouves nulle part dans le profil ni dans les messages réels, tout objet ou chiffre que tu as inventé, tout commentaire familier sur un tiers.

${opts.profile}${samplesBlock}`;

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
