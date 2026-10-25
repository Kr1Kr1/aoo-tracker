// Ouvrir une missive : écrire à quelqu'un qui n'a rien demandé.
//
// C'est le cas le plus exposé des trois (répondre dans un fil, écrire depuis
// une quête, ouvrir un fil neuf) : il n'y a aucune conversation au-dessus du
// champ, donc rien pour rattraper un modèle qui invente. Ce qui tient lieu de
// contexte vient de lib/missiveCorpus : la correspondance déjà eue avec le
// destinataire, et quelques missives voisines par le titre ou les personnes.
// La voix, elle, vient du profil et surtout des vrais messages du personnage.

import { generateObject } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { renderVoiceSamples } from '@/lib/ai/voiceSamples';
import { MissivesSchema, type MissiveDraft } from '@/lib/ai/questMissive';
import type { CorpusThread, MissiveCorpus } from '@/lib/missiveCorpus';

function renderThread(thread: CorpusThread): string {
  const silence =
    thread.silentDays === null ? '' : `, silencieux depuis ${thread.silentDays} jour(s)`;
  const header = `### « ${thread.name} » (${thread.participants.join(', ')}, dernier message le ${thread.lastLabel}${silence})
_${thread.reason}_`;
  const body = thread.excerpts
    .map((excerpt) => `--- ${excerpt.author} (${excerpt.date}) ---\n${excerpt.text}`)
    .join('\n\n');
  return body ? `${header}\n\n${body}` : header;
}

export function renderMissiveCorpus(corpus: MissiveCorpus): string {
  const blocks: string[] = [];

  if (corpus.withRecipient.length) {
    blocks.push(`# CE QUI S'EST DÉJÀ ÉCRIT AVEC ${corpus.recipients.join(' et ').toUpperCase()}

C'est la relation, telle qu'elle est : reprends-en le tutoiement ou le vouvoiement, les formules d'adresse et les surnoms, et n'ouvre pas comme si vous ne vous connaissiez pas. Ce qui y reste en suspens est la seule chose que la missive puisse rappeler sans rien inventer. Un fil collectif (la mention sous le titre le dit) montre un ton de tribune, pas une adresse privée : fie-toi d'abord aux échanges rapprochés.

${corpus.withRecipient.map(renderThread).join('\n\n')}`);
  } else if (corpus.recipients.length) {
    blocks.push(`# AUCUNE MISSIVE ÉCHANGÉE AVEC ${corpus.recipients.join(' et ').toUpperCase()}

Rien dans la correspondance ne les relie. Écris une première approche : vouvoiement par défaut, aucune allusion à un échange passé, aucune familiarité.`);
  }

  if (corpus.related.length) {
    blocks.push(`# MISSIVES VOISINES (autres correspondants)

Rapprochées par leur titre ou par les personnes impliquées. Elles servent de repère de forme (comment ce personnage entame et clôt une lettre) et de rappel de ce qui se sait déjà sur le sujet. Elles ne disent RIEN de la relation avec le destinataire : n'y emprunte ni ton ni familiarité.

${corpus.related.map((thread) => `${renderThread(thread)}\n_(retenue : ${thread.reason})_`).join('\n\n')}`);
  }

  return blocks.join('\n\n---\n\n');
}

export async function generateNewMissive(opts: {
  characterName: string;
  profile?: string | null;
  samples: string[];
  corpus: MissiveCorpus;
  /** Ce que l'auteur veut obtenir ou dire, en clair. */
  intent: string;
  /** Titre voulu, quand l'auteur en a déjà un. */
  subject?: string;
  count?: number;
}): Promise<MissiveDraft[]> {
  const count = Math.min(Math.max(opts.count ?? 2, 1), 4);
  const recipients = opts.corpus.recipients;

  const system = `Tu écris à la place de ${opts.characterName}, un personnage du jeu de rôle en ligne Age of Olympia. Tu rédiges une missive neuve : ${opts.characterName} ouvre un fil, personne ne lui a écrit d'abord.

Quatre règles qui priment sur l'envie de bien écrire :
1. **N'invente rien.** Ni événement, ni engagement, ni rendez-vous, ni objet, ni règle de jeu, ni passé commun. Tout ce que tu nommes vient de l'intention de l'auteur, du corpus ci-dessous ou du profil, ou reste volontairement vague. Un objet ou une mécanique inventés sont l'erreur la plus grave possible.
2. **N'invente pas non plus la relation.** Le tutoiement, le vouvoiement, les surnoms, le degré de familiarité se lisent dans la correspondance fournie. En l'absence de correspondance, c'est le vouvoiement et la distance polie.
3. **Ne fais pas semblant de répondre.** Aucune formule qui suppose un message reçu (« merci de ton retour », « comme convenu ») si le corpus ne le montre pas. Une missive neuve dit qui écrit, pourquoi elle écrit maintenant, et ce qu'elle attend.
4. **Ne délaye pas.** Une missive qui tient en cinq lignes tient en cinq lignes. Un paragraphe ajouté pour faire chaleureux dénature la voix.

Avant de rendre un brouillon, relis-le et supprime : toute expression absente du profil et des messages réels, tout objet ou chiffre inventé, toute allusion à un passé commun que le corpus ne prouve pas, toute familiarité orale moderne. Jamais de tiret cadratin : deux-points, virgule ou parenthèses.${
    opts.profile ? `\n\n---\n\n${opts.profile}` : ''
  }${renderVoiceSamples(opts.characterName, opts.samples)}`;

  const corpusBlock = renderMissiveCorpus(opts.corpus);
  const unknown = opts.corpus.unknownRecipients.length
    ? `\n\nAucune missive connue ne porte le nom de ${opts.corpus.unknownRecipients.join(', ')} : n'invente pas ce que ${opts.characterName} saurait d'eux.`
    : '';

  const prompt = `# LA MISSIVE À ÉCRIRE

Destinataire : ${recipients.length ? recipients.join(', ') : 'non précisé (adresse-toi sans nommer)'}
${opts.subject ? `Titre voulu par l'auteur : « ${opts.subject} » (garde-le tel quel)` : "L'auteur n'a pas fixé de titre : propose-en un, court, comme il apparaîtrait dans le jeu."}

Ce que l'auteur veut faire :

${opts.intent}${unknown}

---

${corpusBlock || '(Aucune missive antérieure à rapprocher : appuie-toi sur la seule intention de l\'auteur et sur la voix du personnage.)'}

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
