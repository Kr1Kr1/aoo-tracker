// Le moteur local (docker, cf. aoo-engine) vu depuis le tracker en dev.
//
// Deux usages, tous deux au service de l'arpentage automatique : lire les
// téléporteurs d'un plan (la topologie du monde, qui ne change pas d'une
// instance à l'autre), et rendre son tour à l'arpenteuse. C'est du docker
// exec sur la machine qui fait tourner le tracker : hors dev, les conteneurs
// manquent et tout ici échoue proprement.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const LOCAL_ENGINE_DB_CONTAINER =
  process.env.LOCAL_ENGINE_DB_CONTAINER || 'aoo-engine-mariadb-aoo4-1';
export const LOCAL_ENGINE_WEB_CONTAINER = process.env.LOCAL_ENGINE_WEB_CONTAINER || 'PHP-AOO4-Local';
const DB_NAME = process.env.LOCAL_ENGINE_DB_NAME || 'aoo4_saison2';
const DB_PASSWORD = process.env.LOCAL_ENGINE_DB_PASSWORD || 'passwordRoot';

/** Une requête SQL sur la base du moteur local ; rend les lignes, colonnes séparées par des tabulations. */
export async function localEngineSql(sql: string): Promise<string[][]> {
  const { stdout } = await run(
    'docker',
    ['exec', LOCAL_ENGINE_DB_CONTAINER, 'mariadb', '-uroot', `-p${DB_PASSWORD}`, DB_NAME, '-N', '-B', '-e', sql],
    { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }
  );
  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
}

/** Un littéral SQL sûr pour une chaîne courte (nom de plan, de joueur). */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** Ce que fait Player::refresh_data() : oublier la copie en cache de la ligne joueur. */
export async function forgetLocalPlayerCache(localId: number): Promise<void> {
  await run(
    'docker',
    ['exec', LOCAL_ENGINE_WEB_CONTAINER, 'rm', '-f', `/var/www/html/datas/private/players/${localId}.json`],
    { timeout: 15_000 }
  );
}

export function localEngineErrorStatus(message: string): number {
  return /ENOENT|No such container|is not running/i.test(message) ? 503 : 500;
}

export type Portal = {
  x: number;
  y: number;
  to: { plan: string; z: number; x: number | null; y: number | null };
};

/**
 * Les téléporteurs d'un niveau de plan qui mènent ailleurs (autre plan ou
 * autre niveau). Un déclencheur « tp » porte « x,y,z,plan », chaque champ
 * pouvant valoir son nom pour dire « inchangé » (cf. scripts/map/triggers/tp.php).
 */
export async function localEnginePortals(plan: string, z: number): Promise<Portal[]> {
  const rows = await localEngineSql(
    `SELECT c.x, c.y, t.params FROM map_triggers t JOIN coords c ON c.id = t.coords_id ` +
      `WHERE t.name = 'tp' AND c.plan = ${sqlLiteral(plan)} AND c.z = ${Number(z)}`
  );
  const portals: Portal[] = [];
  for (const [x, y, params] of rows) {
    const parts = (params || '').split(',').map((p) => p.trim());
    if (parts.length < 4) continue;
    const num = (raw: string) => (/^-?\d+$/.test(raw) ? Number(raw) : null);
    const to = {
      x: num(parts[0]),
      y: num(parts[1]),
      z: num(parts[2]) ?? z,
      plan: parts[3] && parts[3] !== 'plan' ? parts[3] : plan,
    };
    if (to.plan === plan && to.z === z) continue;
    portals.push({ x: Number(x), y: Number(y), to });
  }
  return portals;
}
