// Relire les échanges pour étoffer une quête.
//
// L'auteur a noté deux lignes ; le dossier remonté par lib/questSearch contient
// ce que le forum en dit vraiment, parfois sur des mois. Le modèle en tire une
// version enrichie : l'historique daté, qui est intervenu et à quel titre, ce
// qui reste en jeu. Il propose, il n'écrase pas : la route rend un brouillon
// que l'auteur applique ou jette.

import { z } from 'zod';
import { generateObject } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import type { EvidenceThread } from '@/lib/questSearch';

const EnrichedSchema = z.object({
  summary: z
    .string()
    .describe(
      "L'histoire telle que les échanges la racontent, dans l'ordre et datée. Commence par la première trace lisible."
    ),
  stake: z.string().describe('Ce qui se joue pour le personnage, tel que les échanges le montrent'),
  nextStep: z.string().describe('Prochaine action concrète, à la lumière de ce qui a été relu'),
  status: z
    .enum(['lead', 'engaged', 'waiting', 'closed'])
    .describe(
      "closed uniquement si les échanges montrent la résolution ; waiting si elle attend un tiers ; engaged si la balle est dans son camp"
    ),
  actors: z
    .array(
      z.object({
        name: z.string().describe('Nom du personnage, tel qu\'il apparaît dans les échanges'),
        role: z.string().describe("Son rôle dans cette histoire, en deux ou trois mots"),
      })
    )
    .describe('Les AUTRES personnages qui interviennent réellement dans cette intrigue'),
  topicIds: z.array(z.number()).describe('Fils du dossier qui portent cette intrigue'),
  messageIds: z
    .array(z.number())
    .max(8)
    .describe('Messages msg#… qui font la trace : les moments qui nouent et relancent l\'affaire'),
  findings: z
    .array(z.string())
    .max(8)
    .describe("Ce que la relecture apprend et qui n'était pas au carnet, une phrase par point"),
});

export type EnrichedQuest = z.infer<typeof EnrichedSchema>;

function renderThread(thread: EvidenceThread): string {
  const header = [
    `### Fil #${thread.topicId} — « ${thread.name} » (${thread.channelLabel})`,
    thread.linked ? 'Déjà rattaché à la quête.' : 'Pas encore rattaché.',
    `Participants : ${thread.participants.join(', ') || 'aucun'}`,
    `${thread.messageCount} message(s) retenus par la recherche, les plus proches ci-dessous.`,
  ].join('\n');

  const body = thread.messages
    .map((m) => `--- msg#${m.messageId} · ${m.author} (${m.date}) ---\n${m.text}`)
    .join('\n\n');

  return `${header}\n\n${body}`;
}

export async function enrichQuestFromEvidence(opts: {
  characterName: string;
  quest: {
    title: string;
    summary: string | null;
    stake: string | null;
    nextStep: string | null;
    status: string;
    actors: { name: string; role: string | null }[];
    linkedTopicNames: string[];
  };
  threads: EvidenceThread[];
  terms: string[];
  instructions?: string;
}): Promise<EnrichedQuest> {
  const system = `Tu tiens le carnet de quêtes de ${opts.characterName}, personnage du jeu de rôle en ligne Age of Olympia.

Une quête est déjà au carnet, notée à la main : elle est courte et peut-être incomplète. On a relu pour toi tout ce que le forum garde de lisible (RP, forums privés, missives) et on te remonte les passages qui en parlent. Ton travail : reconstituer l'histoire à partir de ces passages, et rendre une fiche à jour.

Quatre règles, dans l'ordre :
1. **N'invente rien.** Chaque fait vient d'un passage ci-dessous ou de la fiche existante. Pas d'événement supposé, pas de motivation prêtée, pas de personnage absent des extraits. Si un point reste obscur après lecture, dis-le dans \`findings\` au lieu de le combler.
2. **Date ce que tu racontes.** \`summary\` suit l'ordre des échanges et cite les dates lisibles dans les extraits. C'est ce qui rend une affaire de plusieurs mois relisible.
3. **Respecte ce que l'auteur a écrit.** Sa fiche dit son intention : tu la complètes, tu ne la contredis pas. Si un passage la dément, signale-le dans \`findings\` plutôt que de réécrire son intrigue.
4. **Ne cite que ce que tu vois.** \`topicIds\` et \`messageIds\` ne contiennent que des identifiants présents ci-dessous. Dans \`actors\`, uniquement les personnages qui interviennent vraiment : ${opts.characterName} tient ce carnet, elle n'y figure pas.

La recherche est approximative : elle a remonté des passages sur des mots communs avec la quête, certains n'ont rien à voir. Écarte-les sans le signaler.

Écris en français, dans une langue de notes : sobre, factuelle, sans emphase romanesque. Jamais de tiret cadratin : deux-points, virgule ou parenthèses.`;

  const current = [
    `Titre : ${opts.quest.title}`,
    `Statut : ${opts.quest.status}`,
    opts.quest.summary ? `Résumé actuel : ${opts.quest.summary}` : 'Résumé actuel : (vide)',
    opts.quest.stake ? `Enjeu noté : ${opts.quest.stake}` : 'Enjeu noté : (vide)',
    opts.quest.nextStep ? `Prochaine action notée : ${opts.quest.nextStep}` : 'Prochaine action : (vide)',
    opts.quest.actors.length
      ? `Acteurs déjà au carnet : ${opts.quest.actors
          .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
          .join(', ')}`
      : 'Acteurs déjà au carnet : aucun',
    opts.quest.linkedTopicNames.length
      ? `Fils déjà rattachés : ${opts.quest.linkedTopicNames.join(' ; ')}`
      : 'Fils déjà rattachés : aucun',
  ].join('\n');

  const prompt = `# LA FICHE ACTUELLE

${current}

# CE QUE LA RELECTURE A REMONTÉ

Recherche menée sur : ${opts.terms.join(', ')}

${opts.threads.map(renderThread).join('\n\n')}

---

Rends la fiche à jour : l'histoire dans l'ordre, qui intervient et à quel titre, ce qui reste en jeu, la suite. Dans \`findings\`, ce que cette relecture apprend et que la fiche ne disait pas.${
    opts.instructions ? `\n\nConsigne particulière de l'auteur : ${opts.instructions}` : ''
  }`;

  const { object } = await generateObject({
    model: claudeCode(process.env.AI_QUEST_MODEL || process.env.AI_DRAFT_MODEL || 'sonnet'),
    schema: EnrichedSchema,
    system,
    prompt,
  });

  return object;
}
