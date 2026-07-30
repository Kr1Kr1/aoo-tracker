// Fils rouges : ce qui revient sous la plume d'un personnage.
//
// La détection d'intrigues lit des fils récents, coupés à leurs derniers
// messages. Une poursuite au long cours y échappe par construction : quand
// Medarda cherche Zeus depuis huit mois, ses 38 messages sur le sujet sont
// éparpillés dans vingt fils dont un seul a bougé ce trimestre. Le modèle ne
// voit alors qu'un fil isolé, jamais l'obsession.
//
// Ce module fait le travail que le modèle ne peut pas faire : compter. Il
// relève les noms propres qui reviennent dans les messages du personnage,
// mesure leur étendue (combien de fils, sur combien de mois) et en garde
// quelques citations datées. Rien n'est interprété ici : un motif n'est pas une
// intrigue, c'est l'indice qu'il y en a peut-être une, qu'on donne à lire au
// modèle à côté du dossier de fils.
//
// Volontairement sans dépendance (ni Prisma, ni alias `@/`) : les entrées sont
// du texte déjà nettoyé et des dates déjà résolues, ce qui rend la passe
// testable hors du serveur.

const DAY_MS = 86_400_000;

export type MotifSource = {
  topicId: number;
  topicName: string;
  /** Date du message, en ms. */
  at: number;
  /** Contenu en texte brut (HTML déjà retiré). */
  text: string;
};

export type MotifQuote = {
  topicId: number;
  topicName: string;
  dateLabel: string;
  text: string;
};

export type RecurringMotif = {
  /** Le nom tel qu'il s'écrit (forme canonique de la base si connue). */
  term: string;
  /** Le nom correspond à un personnage en base. */
  known: boolean;
  /** Messages du personnage qui le citent (une mention par message). */
  mentions: number;
  /** Fils distincts, dédoublonnés sur le nom (la base garde des fils en double). */
  topicCount: number;
  topicIds: number[];
  firstLabel: string;
  lastLabel: string;
  /** Jours entre la première et la dernière mention. */
  spanDays: number;
  /** Jours depuis la dernière mention. */
  silentDays: number;
  /**
   * Combien de fois plus souvent le personnage cite ce nom, comparé au reste du
   * forum. 1 = tout le monde en parle autant (du décor), 8 = une obsession.
   */
  salience: number;
  quotes: MotifQuote[];
};

// Mots capitalisés qui ne nomment personne : débuts de phrase, titres,
// vocabulaire courant du RP. La règle « vu au moins deux fois en milieu de
// phrase » filtre le reste ; cette liste évite juste le gros du bruit.
const STOPWORDS = new Set(
  [
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'ce', 'cet', 'cette', 'ces',
    'il', 'elle', 'ils', 'elles', 'on', 'nous', 'vous', 'je', 'tu', 'lui', 'leur',
    'mon', 'son', 'sa', 'ses', 'mes', 'notre', 'votre', 'toi', 'moi', 'soi',
    'et', 'mais', 'ou', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont',
    'puis', 'alors', 'ainsi', 'apres', 'avant', 'depuis', 'pendant', 'quand',
    'comme', 'pour', 'par', 'sans', 'sous', 'sur', 'dans', 'vers', 'chez', 'entre',
    'peut', 'peu', 'plus', 'moins', 'tout', 'toute', 'tous', 'toutes', 'rien',
    'oui', 'non', 'merci', 'bonjour', 'salut', 'adieu', 'voici', 'voila',
    'jamais', 'toujours', 'encore', 'enfin', 'bien', 'mal', 'trop', 'aussi',
    'faut', 'faire', 'dire', 'voir', 'savoir', 'pourquoi', 'comment', 'combien',
    'dame', 'sire', 'messire', 'maitre', 'maitresse', 'seigneur', 'dieu', 'deesse',
    'monsieur', 'madame', 'mademoiselle', 'frere', 'soeur', 'pere', 'mere',
    'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout',
    'septembre', 'octobre', 'novembre', 'decembre',
    'hrp', 'rp', 'pj', 'pnj', 'mj', 'edit', 'ooc',
    'est-ce', "qu'est-ce", 'peut-etre', "aujourd'hui", 'la-bas', 'celui-ci', 'celle-ci',
    // Coulisses du jeu : ça parle des joueurs, pas des personnages.
    'discord', 'forum', 'google', 'excel', 'internet', 'wiki', 'topic', 'post',
    'numero', 'message', 'sujet', 'reponse', 'question', 'merci', 'bonne', 'bonjour',
  ]
);

// Ce qui sent l'affaire en cours : une citation qui contient un de ces mots vaut
// mieux, pour illustrer un motif, qu'un « Bonjour Untel » daté du même jour.
const CUES = [
  'cherch', 'retrouv', 'disparu', 'introuvable', 'trace', 'piste', 'enquet', 'enquêt',
  'promis', 'promess', 'jur', 'serment', 'dette', 'dois', 'devra',
  'secret', 'myster', 'mystèr', 'vision', 'reve', 'rêve', 'prophet', 'prophét',
  'menac', 'vengeanc', 'traitr', 'traîtr', 'trahi', 'guerre', 'attaqu',
  'rendez-vous', 'attend', 'reponse', 'réponse', 'sans nouvelle', 'toujours pas',
  'quete', 'quête', 'mission', 'faveur', 'aide', 'prevenir', 'prévenir',
];

/**
 * Les apartés HRP se glissent dans les fils RP (« HRP : je serai absente… »).
 * Ils parlent des joueurs, pas de l'histoire : on les retire avant de compter.
 */
/**
 * Vrai si une seule correction sépare les deux mots : ajout, retrait,
 * substitution ou inversion de deux lettres voisines (« Preatorium »).
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    const diff: number[] = [];
    for (let k = 0; k < a.length && diff.length <= 2; k += 1) if (a[k] !== b[k]) diff.push(k);
    if (diff.length === 2 && diff[1] === diff[0] + 1) {
      const [i, j] = diff;
      if (a[i] === b[j] && a[j] === b[i]) return true;
    }
  }

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (++edits > 1) return false;
    if (short.length === long.length) i += 1;
    j += 1;
  }
  return edits + (long.length - j) + (short.length - i) <= 1;
}

function cueScore(text: string): number {
  const folded = foldName(text);
  return CUES.reduce((total, cue) => (folded.includes(cue) ? total + 1 : total), 0);
}

function stripHrpAsides(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*[(\[]?\s*(hrp|ooc|hors[- ]rp|hors[- ]jeu)\b/i.test(line))
    .join('\n');
}

export function foldName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019']/g, "'")
    .trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Phrase qui porte l'occurrence, resserrée autour d'elle. */
function sentenceAround(text: string, index: number, max = 240): string {
  const start = Math.max(
    text.lastIndexOf('.', index),
    text.lastIndexOf('!', index),
    text.lastIndexOf('?', index),
    text.lastIndexOf('\n', index)
  );
  const rest = text.slice(index);
  const endOffset = rest.search(/[.!?\n]/);
  const end = endOffset === -1 ? text.length : index + endOffset + 1;

  let quote = text.slice(start + 1, end).replace(/\s+/g, ' ').trim();
  if (quote.length > max) {
    // Garder l'occurrence dans la fenêtre plutôt que couper bêtement au début.
    const local = Math.max(0, index - start - 1 - Math.floor(max / 3));
    quote = `…${quote.slice(local, local + max).trim()}…`;
  }
  return quote;
}

type Bucket = {
  term: string;
  known: boolean;
  midSentence: number;
  mentions: number;
  topicKeys: Set<string>;
  /** Clés (fil, date) déjà comptées : la base garde des fils en double. */
  seenKeys: Set<string>;
  topicLast: Map<number, number>;
  firstAt: number;
  lastAt: number;
  quotes: (MotifQuote & { at: number })[];
};

const TOKEN = /\p{Lu}[\p{L}'’-]{2,}/gu;

/**
 * Élision française : « J'ai », « C'est », « L'homme ». Une lettre suivie d'une
 * apostrophe n'est jamais un nom (« Nec'h Hîr » garde la sienne plus loin).
 */
const ELISION = /^\p{L}['’]/u;

/**
 * Combien de messages citent chaque nom, un message comptant une fois. Sert à
 * mesurer le fond de conversation du forum : ce que tout le monde nomme
 * (Praetorium, Olympia) est du décor, pas une intrigue.
 */
export function countTermMentions(texts: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of texts) {
    if (!raw) continue;
    // Même traitement que du côté du personnage, sinon la comparaison boite.
    const text = stripHrpAsides(raw);
    const seenHere = new Set<string>();
    for (const match of text.matchAll(TOKEN)) {
      const raw = match[0];
      if (ELISION.test(raw)) continue;
      const folded = foldName(raw);
      if (folded.length < 3 || seenHere.has(folded)) continue;
      seenHere.add(folded);
      counts.set(folded, (counts.get(folded) ?? 0) + 1);
    }
  }
  return counts;
}

export function extractRecurringMotifs(opts: {
  /** Messages écrits par le personnage, hors HRP. */
  messages: MotifSource[];
  /** Personnages connus de la base : leur nom prime sur l'heuristique. */
  knownNames: string[];
  /** Le personnage lui-même : il ne se cite pas comme motif. */
  ownName: string;
  now?: number;
  limit?: number;
  /** Motifs déjà couverts par une quête au carnet (titres, résumés). */
  covered?: string[];
  /**
   * Fond de conversation du forum (cf. countTermMentions sur les messages des
   * autres). Sans lui, le classement remonte le décor : à Praetorium, tout le
   * monde dit « Praetorium ».
   */
  background?: { counts: Map<string, number>; total: number };
}): RecurringMotif[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 10;
  const ownTotal = Math.max(opts.messages.length, 1);
  const background = opts.background;
  // Lissage : un nom que personne d'autre n'écrit vaut « un message sur tout le
  // corpus », pas l'infini.
  const epsilon = background ? 1 / Math.max(background.total, 1) : 0;

  const known = new Map<string, string>();
  for (const name of opts.knownNames) {
    const folded = foldName(name);
    if (folded.length >= 3) known.set(folded, name);
  }

  const own = new Set(foldName(opts.ownName).split(/\s+/).filter(Boolean));
  const coveredText = foldName((opts.covered ?? []).join(' '));

  // Vocabulaire courant du forum : sert à reconnaître les coquilles. Une graphie
  // que personne d'autre n'écrit et qui est à une lettre d'un mot que tout le
  // monde écrit (« Preatorium ») n'est pas une obsession, c'est une faute de
  // frappe, et elle affiche une saillance énorme si on la laisse passer.
  const common: string[] = [];
  if (background) {
    for (const [term, count] of background.counts) {
      if (count >= 10) common.push(term);
    }
  }

  const buckets = new Map<string, Bucket>();

  for (const source of opts.messages) {
    if (!source.text) continue;
    const message = { ...source, text: stripHrpAsides(source.text) };
    const seenHere = new Set<string>();

    for (const match of message.text.matchAll(TOKEN)) {
      const raw = match[0];
      if (ELISION.test(raw)) continue;
      const folded = foldName(raw);
      if (folded.length < 3 || own.has(folded) || STOPWORDS.has(folded)) continue;

      const canonical = known.get(folded);
      const index = match.index ?? 0;

      // Début de phrase : « Depuis ce jour… » capitalise des mots quelconques.
      // Un nom propre se reconnaît à ce qu'il apparaît aussi ailleurs.
      const before = message.text.slice(Math.max(0, index - 3), index);
      const atSentenceStart = index === 0 || /[.!?\n:«"]\s*$/.test(before) || /^\s*$/.test(before);

      let bucket = buckets.get(folded);
      if (!bucket) {
        bucket = {
          term: canonical ?? raw,
          known: Boolean(canonical),
          midSentence: 0,
          mentions: 0,
          topicKeys: new Set(),
          seenKeys: new Set(),
          topicLast: new Map(),
          firstAt: message.at,
          lastAt: message.at,
          quotes: [],
        };
        buckets.set(folded, bucket);
      }
      if (!atSentenceStart) bucket.midSentence += 1;

      // Une mention par message : un nom répété dix fois dans un même post
      // signale un post bavard, pas une intrigue qui dure.
      if (seenHere.has(folded)) continue;
      seenHere.add(folded);

      const topicKey = foldName(message.topicName);
      // Un même message revient parfois deux fois, sous deux copies du fil :
      // le compter deux fois gonflerait l'obsession pour rien.
      const dedupeKey = `${topicKey}|${message.at}`;
      if (bucket.seenKeys.has(dedupeKey)) continue;
      bucket.seenKeys.add(dedupeKey);

      bucket.mentions += 1;
      bucket.topicKeys.add(topicKey);
      const previous = bucket.topicLast.get(message.topicId) ?? 0;
      if (message.at > previous) bucket.topicLast.set(message.topicId, message.at);
      bucket.firstAt = Math.min(bucket.firstAt, message.at);
      bucket.lastAt = Math.max(bucket.lastAt, message.at);
      bucket.quotes.push({
        topicId: message.topicId,
        topicName: message.topicName,
        dateLabel: formatDay(message.at),
        text: sentenceAround(message.text, index),
        at: message.at,
      });
    }
  }

  const motifs: (RecurringMotif & { score: number })[] = [];
  for (const [folded, bucket] of buckets) {
    if (!bucket.known && bucket.midSentence < 2) continue;
    if (coveredText.includes(foldName(bucket.term))) continue;

    const topicCount = bucket.topicKeys.size;
    const spanDays = Math.floor((bucket.lastAt - bucket.firstAt) / DAY_MS);
    if (bucket.mentions < 3 || topicCount < 2) continue;
    // Ce qu'on cherche, c'est ce qui dure : un motif né la semaine dernière
    // est déjà lisible dans les fils récents du dossier.
    if (spanDays < 30) continue;
    if (topicCount < 3 && spanDays < 60) continue;

    // Saillance : sa part de messages citant le nom, rapportée à celle du reste
    // du forum. En dessous de 1,5 le nom appartient au paysage commun (un lieu
    // où tout le monde vit, un peuple dont tout le monde parle).
    const salience = background
      ? (bucket.mentions / ownTotal + epsilon) /
        ((background.counts.get(folded) ?? 0) / Math.max(background.total, 1) + epsilon)
      : 1;
    if (background && salience < 1.5) continue;
    if (
      !bucket.known &&
      (background?.counts.get(folded) ?? 0) < 5 &&
      common.some((term) => term !== folded && withinOneEdit(term, folded))
    ) {
      continue;
    }

    // La trace se lit dans le temps : la première mention et la dernière tiennent
    // les deux bouts. Entre les deux, on garde ce qui parle d'affaire en cours
    // plutôt qu'une salutation datée du bon jour.
    const quotes = [...bucket.quotes].sort((a, b) => a.at - b.at);
    const picked = (
      quotes.length <= 4
        ? quotes
        : [
            quotes[0],
            ...quotes
              .slice(1, -1)
              .map((quote) => ({ quote, cues: cueScore(quote.text) }))
              .sort((a, b) => b.cues - a.cues || b.quote.at - a.quote.at)
              .slice(0, 2)
              .map((entry) => entry.quote)
              .sort((a, b) => a.at - b.at),
            quotes[quotes.length - 1],
          ]
    ).map(({ at, ...quote }) => quote);

    motifs.push({
      term: bucket.term,
      known: bucket.known,
      mentions: bucket.mentions,
      topicCount,
      topicIds: [...bucket.topicLast.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id]) => id),
      firstLabel: formatDay(bucket.firstAt),
      lastLabel: formatDay(bucket.lastAt),
      spanDays,
      silentDays: Math.max(0, Math.floor((now - bucket.lastAt) / DAY_MS)),
      salience: Math.round(salience * 10) / 10,
      quotes: picked,
      // Ce qui pèse : le nom lui appartient (saillance), il traverse des fils,
      // et il traverse des mois. La saillance compte en échelle log : une coquille
      // que personne d'autre n'écrit affiche un rapport énorme sans rien valoir,
      // elle ne doit pas devancer une affaire de vingt fils.
      score:
        (1 + Math.log2(Math.min(Math.max(salience, 1), 8))) *
        (topicCount * 3 + spanDays / 30 + bucket.mentions / 4),
    });
  }

  motifs.sort((a, b) => b.score - a.score);
  return motifs.slice(0, limit).map(({ score, ...motif }) => motif);
}
