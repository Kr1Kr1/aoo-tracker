// Écrire une missive à partir d'une quête, dans la voix du personnage.
//
// Deux usages, le même chemin : soit l'auteur clique et laisse la quête parler
// (la prochaine action du carnet fait l'intention), soit il dit d'abord ce qu'il
// veut faire et le modèle l'écrit dans le ton. La voix vient du profil quand il
// existe, et surtout des vrais messages du personnage (lib/ai/voiceSamples).

import { z } from 'zod';
import { generateObject } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { renderVoiceSamples } from '@/lib/ai/voiceSamples';
import type { TranscriptMessage } from '@/lib/ai/draftReplies';

const MissivesSchema = z.object({
  drafts: z
    .array(
      z.object({
        subject: z.string().describe('Titre de la missive, court, tel qu\'il apparaîtrait dans le jeu'),
        body: z.string().min(1).describe('Corps de la missive, prêt à coller dans le jeu'),
        angle: z.string().describe("En quelques mots, l'angle choisi : ce qui distingue ce brouillon des autres"),
      })
    )
    .min(1)
    .max(4),
});

export type MissiveDraft = z.infer<typeof MissivesSchema>['drafts'][number];

export type QuestBrief = {
  title: string;
  summary: string | null;
  stake: string | null;
  nextStep: string | null;
  status: string;
  actors: { name: string; role: string | null }[];
  threads: {
    name: string;
    channel: string;
    lastLabel: string;
    silentDays: number | null;
    excerpts: TranscriptMessage[];
  }[];
};

function renderQuest(quest: QuestBrief): string {
  const lines = [
    `## ${quest.title}`,
    quest.summary ? `Où ça en est : ${quest.summary}` : null,
    quest.stake ? `Ce qui se joue pour elle : ${quest.stake}` : null,
    quest.nextStep ? `Prochaine action notée au carnet : ${quest.nextStep}` : null,
    quest.actors.length
      ? `Personnes impliquées : ${quest.actors
          .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
          .join(', ')}`
      : null,
  ].filter(Boolean);

  const threads = quest.threads
    .map((thread) => {
      const header = `### Fil rattaché : « ${thread.name} » (${thread.channel}, dernier message le ${thread.lastLabel}${
        thread.silentDays === null ? '' : `, silencieux depuis ${thread.silentDays} jour(s)`
      })`;
      const body = thread.excerpts
        .map((m) => `--- ${m.author} (${m.date}) ---\n${m.text}`)
        .join('\n\n');
      return body ? `${header}\n\n${body}` : header;
    })
    .join('\n\n');

  return threads ? `${lines.join('\n')}\n\n${threads}` : lines.join('\n');
}

export async function generateQuestMissives(opts: {
  characterName: string;
  profile?: string | null;
  samples: string[];
  quest: QuestBrief;
  /** Ce que l'auteur veut faire, quand il le dit avant de cliquer. */
  intent?: string;
  /** Destinataire imposé, quand l'auteur le choisit. */
  recipient?: string;
  count?: number;
}): Promise<MissiveDraft[]> {
  const count = Math.min(Math.max(opts.count ?? 2, 1), 4);

  const system = `Tu écris à la place de ${opts.characterName}, un personnage du jeu de rôle en ligne Age of Olympia. Tu rédiges une missive : un message envoyé à une ou plusieurs personnes, à propos d'une intrigue en cours de son carnet.

Trois règles qui priment sur l'envie de bien écrire :
1. **N'invente rien.** Ni événement, ni engagement, ni rendez-vous, ni objet, ni règle de jeu. Tout ce que tu nommes vient de la quête, des fils rattachés, du profil, ou reste volontairement vague. Un objet ou une mécanique inventés sont l'erreur la plus grave possible. Si la quête ne dit pas ce que ${opts.characterName} sait, elle ne l'écrit pas.
2. **Ne délaye pas.** Une missive qui tient en cinq lignes tient en cinq lignes. Un paragraphe ajouté pour faire chaleureux dénature la voix.
3. **Écris à quelqu'un.** Une missive s'adresse : ouverture, demande claire, clôture. Respecte la relation telle qu'elle se lit dans les fils (tutoiement ou vouvoiement, surnoms, ton) plutôt que d'inventer une familiarité.

Avant de rendre un brouillon, relis-le et supprime : toute expression absente du profil et des messages réels, tout objet ou chiffre inventé, toute familiarité orale moderne. Jamais de tiret cadratin : deux-points, virgule ou parenthèses.${
    opts.profile ? `\n\n---\n\n${opts.profile}` : ''
  }${renderVoiceSamples(opts.characterName, opts.samples)}`;

  const intentBlock = opts.intent
    ? `\n\n# CE QUE L'AUTEUR VEUT FAIRE\n\n${opts.intent}\n\nC'est l'intention à servir : elle prime sur la prochaine action notée au carnet.`
    : `\n\nL'auteur n'a pas précisé d'intention : sers la prochaine action notée au carnet. Si elle est vide, écris la relance la plus évidente au vu de ce qui reste en suspens.`;

  const prompt = `# LA QUÊTE

${renderQuest(opts.quest)}${intentBlock}${
    opts.recipient ? `\n\n# DESTINATAIRE\n\nLa missive s'adresse à ${opts.recipient}.` : ''
  }

---

Propose ${count} brouillon(s) de missive distincts (angles ou tons différents). Chaque brouillon donne un titre court, le corps du message en français prêt à coller dans le jeu, et l'angle choisi en quelques mots.`;

  const { object } = await generateObject({
    model: claudeCode(process.env.AI_DRAFT_MODEL || 'sonnet'),
    schema: MissivesSchema,
    system,
    prompt,
  });

  return object.drafts.slice(0, count);
}
