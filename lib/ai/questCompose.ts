// Une quête dictée en clair, mise en fiche.
//
// L'auteur écrit ce qu'il a en tête (« ça fait des mois que je cherche Zeus,
// Memestra a laissé tomber, il me reste la piste de Leyrion ») ; le modèle
// range ça dans les champs du carnet et rattache les fils qui correspondent.
// Il ne complète pas l'histoire : ce qui n'est pas dit reste vide.

import { z } from 'zod';
import { generateObject } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import type { LinkableTopic } from '@/lib/quests';
import { CHANNEL_LABEL } from '@/lib/questStatus';

const ComposedSchema = z.object({
  title: z.string().min(3).describe("Titre court de l'intrigue, sans nom de joueur hors-jeu"),
  summary: z.string().describe("L'intrigue telle que l'auteur la raconte, remise au propre"),
  stake: z.string().describe("Ce qui se joue pour le personnage, si l'auteur le dit"),
  nextStep: z.string().describe("Prochaine action concrète, si l'auteur l'indique"),
  status: z
    .enum(['lead', 'engaged', 'waiting'])
    .describe("lead = pas encore entrée dedans, engaged = à elle de jouer, waiting = attend un tiers"),
  topicIds: z.array(z.number()).describe('Identifiants des fils proposés qui portent cette intrigue'),
  actors: z.array(z.string()).describe('Noms des AUTRES personnages cités par l\'auteur'),
});

export type ComposedQuest = z.infer<typeof ComposedSchema>;

export async function composeQuestFromText(opts: {
  characterName: string;
  text: string;
  topics: LinkableTopic[];
}): Promise<ComposedQuest> {
  const catalogue = opts.topics
    .map(
      (topic) =>
        `- #${topic.topicId} « ${topic.name} » (${CHANNEL_LABEL[topic.channel]}, dernier message le ${topic.lastLabel}${
          topic.involved ? '' : ", jamais intervenue"
        })`
    )
    .join('\n');

  const system = `Tu tiens le carnet de quêtes de ${opts.characterName}, personnage du jeu de rôle en ligne Age of Olympia. L'auteur du personnage te dicte une intrigue en clair ; tu la ranges dans les champs du carnet.

Quatre règles :
1. **Tu ranges, tu n'inventes pas.** Tout ce que tu écris vient du texte de l'auteur. S'il ne dit pas l'enjeu, \`stake\` reste vide plutôt que deviné. S'il ne dit pas quoi faire ensuite, \`nextStep\` reste vide. Aucun personnage, lieu, objet ou événement qu'il n'a pas nommé.
2. **Tu gardes ses mots.** Reformule pour la clarté, jamais pour embellir : pas d'emphase romanesque ajoutée, pas de vocabulaire qu'il n'emploie pas.
3. **Tu ne rattaches que du sûr.** \`topicIds\` ne contient que des fils du catalogue ci-dessous dont l'auteur parle explicitement, par leur nom ou de façon non ambiguë. Dans le doute, liste vide : l'auteur rattachera lui-même.
4. **\`actors\` ne liste que les autres.** ${opts.characterName} tient ce carnet, elle n'y figure pas. Reprends les noms tels que l'auteur les écrit.

Écris en français, dans une langue de notes : sobre, factuelle. Jamais de tiret cadratin : deux-points, virgule ou parenthèses.`;

  const prompt = `# CE QUE DIT L'AUTEUR

${opts.text}

# FILS RATTACHABLES

${catalogue || '(aucun fil disponible)'}

---

Range cette intrigue dans les champs du carnet.`;

  const { object } = await generateObject({
    model: claudeCode(process.env.AI_QUEST_MODEL || process.env.AI_DRAFT_MODEL || 'sonnet'),
    schema: ComposedSchema,
    system,
    prompt,
  });

  return object;
}
