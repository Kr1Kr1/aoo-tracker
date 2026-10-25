// La saison en cours du jeu. Les plans de cette saison ont le nom de base
// (olympia), ceux des saisons closes portent leur saison en suffixe
// (olympia_s2) : voir scripts/archiveSeason.mjs. CURRENT_SEASON permet de
// passer à la suivante sans redéployer.
export const CURRENT_SEASON = Number(process.env.CURRENT_SEASON) || 3;

/** Un plan de la saison en cours : la sienne, ou sans saison (toutes saisons). */
export function isCurrentSeason(season: number | null | undefined): boolean {
  return season == null || season === CURRENT_SEASON;
}

/**
 * Les seules personas dont les relevés alimentent la carte de la saison en
 * cours : Medarda (232) et Neige (-9). Ce qu'elles voient fait foi, Neige
 * comprise bien qu'elle soit un PNJ ; tout autre relevé est refusé.
 */
export const SEASON_SOURCE_TARGET_IDS = [232, -9];
