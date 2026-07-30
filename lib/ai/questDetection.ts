// Détection des intrigues en suspens, via le CLI Claude local
// (ai-sdk-provider-claude-code) comme lib/ai/draftReplies.ts : pas de clé API,
// on s'appuie sur la session `claude` authentifiée de la machine.
//
// Le modèle ne fait que *lire* : il repère ce qui reste ouvert dans des fils
// déjà en base et propose des quêtes candidates. Rien n'est écrit en base sans
// validation de l'auteur (cf. app/api/quests/detect).

import { z } from 'zod';
import { generateObject } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import type { CandidateThread, CitableTopic } from '@/lib/quests';
import { CHANNEL_LABEL } from '@/lib/quests';
import type { RecurringMotif } from '@/lib/questMotifs';

const CandidateSchema = z.object({
  title: z.string().min(3).describe("Titre court de l'intrigue, sans nom de joueur hors-jeu"),
  summary: z.string().describe("Ce dont il s'agit, en deux ou trois phrases, faits seulement"),
  looseEnd: z.string().describe('Ce qui reste explicitement en suspens, non résolu à ce jour'),
  stake: z.string().describe("Pourquoi ce personnage s'y implique ou pourrait vouloir s'y impliquer"),
  nextStep: z.string().describe('Une action concrète et immédiate, formulée à la première personne'),
  status: z
    .enum(['lead', 'engaged', 'waiting'])
    .describe("lead = pas encore entrée dedans, engaged = balle dans son camp, waiting = attend un tiers"),
  topicIds: z.array(z.number()).min(1).describe('Identifiants des fils fournis qui portent cette intrigue'),
  actors: z
    .array(z.string())
    .describe('Noms des AUTRES personnages impliqués, tels qu\'ils apparaissent dans les fils'),
});

const DetectionSchema = z.object({
  quests: z.array(CandidateSchema).max(8),
});

export type QuestCandidate = z.infer<typeof CandidateSchema>;

function renderThread(thread: CandidateThread): string {
  const header = [
    `### Fil #${thread.topicId} — « ${thread.name} »`,
    `Canal : ${CHANNEL_LABEL[thread.channel]}`,
    thread.involved
      ? 'Le personnage écrit dans ce fil.'
      : "Le personnage n'a jamais écrit dans ce fil (il l'observe de l'extérieur).",
    `Participants : ${thread.participants.join(', ') || 'aucun'}`,
    `${thread.messageCount} message(s) · dernier le ${thread.lastLabel}, de ${
      thread.lastIsMine ? 'elle' : thread.lastAuthor
    } · silencieux depuis ${thread.silentDays} jour(s)`,
    thread.messageCount > thread.excerpts.length
      ? `Extraits : le premier message, puis les ${thread.excerpts.length - 1} derniers (le milieu du fil n'est pas montré).`
      : 'Extraits : le fil entier.',
  ].join('\n');

  const body = thread.excerpts
    .map((e) => `--- ${e.author} (${e.date}) ---\n${e.text}`)
    .join('\n\n');

  return `${header}\n\n${body}`;
}

function renderMotif(motif: RecurringMotif, characterName: string): string {
  const header =
    `### ${motif.term}${motif.known ? '' : ' (nom non rattaché à une fiche)'} — ` +
    `${motif.mentions} message(s) de ${characterName}, ${motif.topicCount} fil(s), ` +
    `du ${motif.firstLabel} au ${motif.lastLabel} (${motif.spanDays} jours), ` +
    `plus rien depuis ${motif.silentDays} jour(s) · elle en parle ${motif.salience}× plus que le reste du forum` +
    `\nFils : ${motif.topicIds.map((id) => `#${id}`).join(', ')}`;

  const quotes = motif.quotes
    .map((q) => `- ${q.dateLabel} (fil #${q.topicId}, « ${q.topicName} ») : « ${q.text} »`)
    .join('\n');

  return `${header}\n${quotes}`;
}

function renderCitableTopic(topic: CitableTopic): string {
  return `- #${topic.topicId} « ${topic.name} » (${CHANNEL_LABEL[topic.channel]}, muet depuis ${topic.silentDays} j)`;
}

export async function detectQuestCandidates(opts: {
  characterName: string;
  /** Profil de voix du personnage, quand il existe : sert à juger l'enjeu. */
  profile?: string | null;
  threads: CandidateThread[];
  /** Ce qui revient sous sa plume au fil des mois (cf. lib/questMotifs). */
  motifs?: RecurringMotif[];
  /** Fils cités par les motifs, rattachables sans être détaillés. */
  motifTopics?: CitableTopic[];
  /** Quêtes déjà au carnet, pour ne pas les reproposer. */
  existingTitles?: string[];
  count?: number;
  instructions?: string;
}): Promise<QuestCandidate[]> {
  const count = Math.min(Math.max(opts.count ?? 5, 1), 8);

  const existingBlock = opts.existingTitles?.length
    ? `\n\nQuêtes déjà au carnet, à ne PAS reproposer :\n${opts.existingTitles.map((t) => `- ${t}`).join('\n')}`
    : '';

  const profileBlock = opts.profile
    ? `\n\n---\n\n# QUI EST ${opts.characterName.toUpperCase()}\n\nUtilise ce profil uniquement pour juger ce qui la concerne et ce qui la ferait bouger. Ne recopie pas son style : tu écris des notes de suivi, pas du roleplay.\n\n${opts.profile}`
    : '';

  const system = `Tu tiens le carnet de quêtes de ${opts.characterName}, personnage du jeu de rôle en ligne Age of Olympia.

On te donne des fils de discussion du jeu (RP, missives, forums privés) tirés d'une base de données. Ton travail : repérer les **intrigues qui n'ont pas trouvé de résolution** et dans lesquelles ${opts.characterName} est impliquée, ou pourrait vouloir s'impliquer.

Une intrigue non résolue, c'est par exemple : une demande restée sans réponse, une menace annoncée mais pas advenue, un rendez-vous jamais tenu, un mystère posé sans explication, un conflit suspendu, une promesse non honorée, une question ouverte dans un fil qui s'est tu, une recherche entamée et jamais aboutie.

Ce qui n'en est PAS une : un échange courtois clos, une transaction terminée, un fil de mentorat où la réponse a été donnée, une discussion HRP d'organisation.

Le dossier a deux parties. Les **fils** te donnent le détail de ce qui se dit en ce moment. Les **fils rouges** te donnent ce que ${opts.characterName} rappelle depuis des mois : un nom compté mécaniquement dans ses propres messages, avec ses dates et quelques citations. Un fil rouge n'est pas une intrigue en soi (ce peut être une simple relation suivie) ; c'est l'indice qu'une affaire longue traîne peut-être sans conclusion. C'est à toi de trancher, à partir des citations : est-ce qu'une question posée il y a huit mois a reçu sa réponse dans les extraits, oui ou non ?

Cinq règles, dans l'ordre de priorité :
1. **N'invente rien.** Chaque fait que tu écris doit être lisible dans les extraits fournis. Un extrait marqué « extrait coupé ici » est tronqué par l'outil : ce n'est pas une phrase laissée en suspens, n'en fais pas un mystère. Pas d'événement supposé, pas d'objet, pas de règle de jeu, pas de personnage absent des fils. Si une intrigue est trop mince pour être décrite sans combler les trous, ne la propose pas.
2. **Cite tes fils.** \`topicIds\` ne contient que des identifiants présents dans le dossier ci-dessous. Une quête sans fil n'existe pas. Dans \`actors\`, ne liste que les autres personnages : ${opts.characterName} tient ce carnet, elle n'y figure pas comme partie prenante.
3. **Sois concret sur la suite.** \`nextStep\` est une action que ${opts.characterName} peut faire dès maintenant (écrire à quelqu'un de nommé, se rendre quelque part de nommé, poser une question précise), pas une intention vague.
4. **Distingue implication et opportunité.** Si elle écrit déjà dans le fil : \`engaged\` (à elle de jouer) ou \`waiting\` (elle attend un tiers). Si elle n'y a jamais écrit : \`lead\`, et \`stake\` explique pourquoi ça pourrait la concerner.
5. **Le silence ne clôt rien.** Une affaire ouverte il y a huit mois et jamais tranchée reste une intrigue : c'est même la plus intéressante, parce que personne n'y pense plus. Quand une quête vient d'un fil rouge, ouvre le \`summary\` par sa durée, en clair et daté (« Depuis le 04/09/2025, … »), et rattache dans \`topicIds\` tous les fils du dossier où l'affaire se lit, pas seulement le plus récent.

Écris en français, dans une langue de notes : sobre, factuelle, sans emphase romanesque. Jamais de tiret cadratin : deux-points, virgule ou parenthèses.${existingBlock}${profileBlock}`;

  const motifBlock = opts.motifs?.length
    ? `\n\n# FILS ROUGES — ce qui revient sous sa plume

Relevé mécanique, non interprété : ces noms reviennent dans ses propres messages, sur la durée indiquée. Le compte « ×N » dit combien de fois plus souvent qu'ailleurs sur le forum elle les emploie.

${opts.motifs.map((motif) => renderMotif(motif, opts.characterName)).join('\n\n')}`
    : '';

  const citableBlock = opts.motifTopics?.length
    ? `\n\n# AUTRES FILS CITABLES

Fils traversés par ces motifs, non détaillés ici : tu peux les rattacher à une quête, mais tu ne peux rien affirmer de leur contenu au-delà des citations ci-dessus.

${opts.motifTopics.map(renderCitableTopic).join('\n')}`
    : '';

  const prompt = `# DOSSIER — fils encore ouverts

${opts.threads.map(renderThread).join('\n\n')}${motifBlock}${citableBlock}

---

Propose au plus ${count} quêtes, les plus solides d'abord. Une intrigue peut couvrir plusieurs fils : dans ce cas regroupe-les dans un seul \`topicIds\`. Cherche d'abord les affaires qui durent, ensuite ce qui vient de s'ouvrir. S'il n'y a rien de sérieux à signaler, renvoie une liste vide.${
    opts.instructions ? `\n\nConsigne particulière de l'auteur : ${opts.instructions}` : ''
  }`;

  const { object } = await generateObject({
    model: claudeCode(process.env.AI_QUEST_MODEL || process.env.AI_DRAFT_MODEL || 'sonnet'),
    schema: DetectionSchema,
    system,
    prompt,
  });

  return object.quests.slice(0, count);
}
