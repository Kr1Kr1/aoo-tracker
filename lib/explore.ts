// Arpentage automatique : où aller pour compléter la carte.
//
// On raisonne sur un seul plan et un seul niveau à la fois. Le tracker connaît
// les cases déjà vues (Coords), celles qu'un mur bouche (MapWalls), et les
// points d'où le personnage a regardé avec son rayon de perception
// (SurveyPoint). Une case est « à voir » quand rien ne l'a jamais couverte :
// ni un relevé, ni le champ de vision d'un point d'observation. La cible est
// la case praticable la plus proche depuis laquelle la vue en révèlera au
// moins une, et on rend le premier pas du chemin qui y mène.
//
// La distance du jeu est celle de l'échiquier (8 voisins, un pas en diagonale
// coûte autant qu'un pas droit), et seule la case d'arrivée peut bloquer : un
// mur, un joueur, un déclencheur « interdit ». Les deux derniers ne sont pas
// dans la carte du tracker, l'arpenteuse les apprend en se cognant et les
// renvoie dans `blocked`.

export type Point = { x: number; y: number };
export type SurveyPoint = Point & { radius: number };

export type ExploreInput = {
  from: Point;
  radius: number;
  known: Point[];
  walls: Point[];
  surveys: SurveyPoint[];
  blocked?: Point[];
  /**
   * Rejoindre une de ces cases plutôt que découvrir : un passage vers une
   * zone, ou le chemin du retour. La plus proche gagne. Les cases visées et
   * leur voisinage immédiat sont praticables par hypothèse même si la carte
   * ne les connaît pas : un téléporteur est souvent posé sur une bordure
   * sans tuile, que le relevé ignore.
   */
  goal?: Point | Point[];
  /** Nombre maximal de cases explorées par la recherche, garde-fou. */
  maxVisited?: number;
};

export type ExploreResult =
  | { done: true; reason: 'no-frontier' | 'at-goal' | 'unreachable' }
  | {
      done: false;
      step: Point;
      target: Point;
      distance: number;
      /** Cases encore jamais vues que la vue depuis la cible révélera. */
      reveals: number;
      /**
       * Chemin « détendu » : la cible n'était pas atteignable par les cases
       * sûres, on a accepté de passer par des murs connus ou des cases jamais
       * vues. Le jeu tranchera ; ce qu'il refuse sera contourné.
       */
      relaxed?: boolean;
    };

// Clés numériques : les ensembles se consultent des millions de fois par
// recherche, une chaîne par case coûterait dix fois plus.
const OFFSET = 50_000;
const SPAN = 100_000;
const key = (x: number, y: number) => (x + OFFSET) * SPAN + (y + OFFSET);
const unkey = (k: number): Point => ({ x: Math.floor(k / SPAN) - OFFSET, y: (k % SPAN) - OFFSET });

/** Rayon autour d'une case visée où l'on accepte de marcher sans la connaître. */
const GOAL_HALO = 2;

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Cases jamais couvertes par aucune vue : ni relevées, ni dans un champ de vision passé. */
function buildCovered(known: Point[], surveys: SurveyPoint[]): Set<number> {
  const covered = new Set<number>();
  for (const c of known) covered.add(key(c.x, c.y));
  for (const s of surveys) {
    for (let dx = -s.radius; dx <= s.radius; dx++) {
      for (let dy = -s.radius; dy <= s.radius; dy++) {
        covered.add(key(s.x + dx, s.y + dy));
      }
    }
  }
  return covered;
}

/** Combien de cases jamais vues la vue depuis `at` révèlerait. */
function revealsFrom(at: Point, radius: number, covered: Set<number>): number {
  let n = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (!covered.has(key(at.x + dx, at.y + dy))) n++;
    }
  }
  return n;
}

export function nextExploreStep(input: ExploreInput): ExploreResult {
  const first = search(input, false);
  if (first.done && first.reason === 'unreachable') {
    // La carte du tracker peut enfermer à tort : murs relevés ailleurs et
    // jamais réobservés ici, trous de relevé. Plutôt que rester coincée, on
    // tente un chemin que le jeu validera pas à pas.
    const second = search(input, true);
    if (!second.done) return { ...second, relaxed: true };
  }
  return first;
}

function search(input: ExploreInput, relaxed: boolean): ExploreResult {
  const { from, radius } = input;
  const maxVisited = input.maxVisited ?? 200_000;

  const wallSet = new Set(input.walls.map((w) => key(w.x, w.y)));
  const blockedSet = new Set((input.blocked ?? []).map((b) => key(b.x, b.y)));
  const walkable = new Set<number>();
  for (const c of input.known) {
    const k = key(c.x, c.y);
    if ((relaxed || !wallSet.has(k)) && !blockedSet.has(k)) walkable.add(k);
  }
  // La case où l'on se tient est praticable par définition, même si la carte
  // ne la connaît pas encore (premier relevé pas encore ingéré).
  walkable.add(key(from.x, from.y));
  const goals = input.goal ? (Array.isArray(input.goal) ? input.goal : [input.goal]) : [];
  const goalKeys = new Set(goals.map((g) => key(g.x, g.y)));
  if (goalKeys.size > 0) {
    if (goalKeys.has(key(from.x, from.y))) return { done: true, reason: 'at-goal' };
    for (const g of goals) {
      for (let dx = -GOAL_HALO; dx <= GOAL_HALO; dx++) {
        for (let dy = -GOAL_HALO; dy <= GOAL_HALO; dy++) {
          const k = key(g.x + dx, g.y + dy);
          if (!wallSet.has(k) && !blockedSet.has(k)) walkable.add(k);
        }
      }
      walkable.add(key(g.x, g.y));
    }
  }

  const covered = buildCovered(input.known, input.surveys);
  // En mode détendu, une case jamais vue (ni relevée, ni dans un champ de
  // vision) peut être du sol ; une case vue mais sans relevé est du vide.
  const maybeWalkable = (k: number) => walkable.has(k) || (relaxed && !covered.has(k) && !blockedSet.has(k));

  // Parcours en largeur depuis la position : la première couche qui contient
  // une case révélant de l'inconnu donne la cible. À distance égale, on prend
  // celle qui en révèle le plus.
  const parent = new Map<number, number | null>();
  const startKey = key(from.x, from.y);
  parent.set(startKey, null);
  let layer: Point[] = [from];
  let distance = 0;
  let visited = 1;

  while (layer.length > 0 && visited <= maxVisited) {
    // La position de départ n'est jamais candidate : l'appelant y a déjà
    // relevé la vue avant de demander où aller.
    let best: { at: Point; reveals: number } | null = null;
    if (goalKeys.size > 0) {
      const reached = layer.find((at) => goalKeys.has(key(at.x, at.y)));
      if (reached) best = { at: reached, reveals: 0 };
    } else if (distance > 0) {
      for (const at of layer) {
        const reveals = revealsFrom(at, radius, covered);
        if (reveals > 0 && (!best || reveals > best.reveals)) best = { at, reveals };
      }
    }
    if (best) {
      // Remonter le chemin jusqu'au premier pas après la position.
      let cursor = key(best.at.x, best.at.y);
      let prev = parent.get(cursor) ?? null;
      while (prev !== null && prev !== startKey) {
        cursor = prev;
        prev = parent.get(cursor) ?? null;
      }
      return { done: false, step: unkey(cursor), target: best.at, distance, reveals: best.reveals };
    }

    const next: Point[] = [];
    for (const at of layer) {
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = at.x + dx;
        const ny = at.y + dy;
        const nk = key(nx, ny);
        if (parent.has(nk) || !maybeWalkable(nk)) continue;
        parent.set(nk, key(at.x, at.y));
        next.push({ x: nx, y: ny });
        visited++;
      }
    }
    layer = next;
    distance++;
  }

  return { done: true, reason: goalKeys.size > 0 ? 'unreachable' : 'no-frontier' };
}
