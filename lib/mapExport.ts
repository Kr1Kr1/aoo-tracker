// Exporter la carte affichée en image, posée sur le parchemin du jeu.
//
// La page carte rend un SVG destiné à l'écran : grille, liseré magenta des
// personas, joueurs, infobulles. Pour une image qu'on partage en jeu, on
// redessine plutôt les mêmes calques dans un canvas, dans le même ordre, sans
// rien d'autre. La feuille de parchemin (img/ui/map/parchemin.webp) sert de
// support : les cases jamais arpentées y restent en papier nu, ce qui donne
// une carte de relevé plutôt qu'une capture d'écran.

// w/h : étendue en cases d'une image composée (bâtiment 2×2), ancrée en haut à gauche.
export type ExportItem = { x: number; y: number; href: string | null; opacity?: number; w?: number; h?: number };

export type ExportRequest = {
  /** Côté d'une case en pixels dans le dessin source (la page utilise 50). */
  tile: number;
  /** Le sol, seul calque qui peut s'estomper pour laisser respirer le papier. */
  ground: ExportItem[];
  /** Les autres calques, dans l'ordre de rendu : routes, murs, éléments, plantes, premier plan. */
  overlays: ExportItem[][];
  /**
   * `parchment` pose la carte sur la feuille du jeu, `paper` la recadre sur un
   * aplat clair, `none` la laisse transparente. Le transparent est le plus
   * souple, mais beaucoup de destinations (forums, messageries) aplatissent
   * l'alpha sur du noir : `paper` donne le même cadrage sans ce risque.
   */
  background: 'parchment' | 'paper' | 'none';
  fadeGround: boolean;
  /** Poids à ne pas dépasser, en octets. Par défaut la limite d'envoi du jeu. */
  maxBytes?: number;
};

export type ExportResult = {
  blob: Blob;
  /** Extension du fichier réellement produit : png, jpg ou webp. */
  extension: string;
  width: number;
  height: number;
  /** Vrai si l'image a dû être réduite pour tenir sous la limite. */
  downscaled: boolean;
};

const PARCHMENT_URL = 'https://age-of-olympia.net/img/ui/map/parchemin.webp';
/** Teinte de repli quand le parchemin n'a pas pu être miroité. */
const PARCHMENT_FALLBACK = '#e8d6ae';
const PARCHMENT_SIZE = { width: 800, height: 532 };
/** La feuille du jeu fait 800×532 : on la rend en 3× pour une image imprimable. */
const SHEET_SCALE = 3;
/** Part de la feuille laissée libre autour de la carte. */
const MARGIN = 0.1;
/** Opacité du sol en mode estompé. */
const FADED_GROUND = 0.55;
/**
 * Le jeu refuse les pièces jointes au-delà de 2 Mo. On vise un peu en dessous :
 * selon qui compte, « 2 Mo » vaut 2 000 000 ou 2 097 152 octets, et la marge
 * couvre les deux lectures.
 */
const DEFAULT_MAX_BYTES = 1_900_000;
/** Qualités tentées, de la plus fidèle à la plus légère. */
const QUALITY_STEPS = [0.96, 0.9, 0.82, 0.74, 0.65];
/** Réductions de taille tentées quand la qualité seule ne suffit plus. */
const SCALE_STEPS = [1, 0.8, 0.65, 0.5, 0.4];
/**
 * Au-delà, les navigateurs rendent un canvas vide sans prévenir. Olympia fait
 * plus de dix mille cases : à 50 px la case, le dessin source dépasserait la
 * limite et l'export sortirait blanc.
 */
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_AREA = 32_000_000;

/**
 * Les `flag_red` sont les points de téléportation : dans les cartes du moteur,
 * les triggers `{"name":"tp"}` tombent exactement sur ces drapeaux. C'est le
 * seul élément « drapeau » de la base, tous plans confondus.
 */
export function isTeleport(item: { name: string }): boolean {
  return item.name === 'flag_red';
}

/** "img/tiles/falaise.png" → "/assets/aom/img/tiles/falaise.png" (miroir local). */
export function localAsset(href: string | null): string | null {
  if (!href) return null;
  const stripped = href.replace(/^https?:\/\/age-of-olympia\.net\//, '').replace(/^\.?\//, '');
  if (!stripped.startsWith('img/')) return href;
  return `/assets/aom/${stripped}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Le parchemin vit sur le site du jeu. On le fait d'abord miroiter par
 * /api/assets (même liste blanche que les tuiles) pour le charger en même
 * origine : une image tierce « salirait » le canvas et rendrait l'export
 * impossible. Rien à committer, le miroir se fait tout seul au premier export.
 */
async function loadParchment(): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [PARCHMENT_URL] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const path = data?.results?.[0]?.path;
    return path ? loadImage(path) : null;
  } catch {
    return null;
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/** Copie réduite d'un canvas, pour retenter l'encodage plus petit. */
function scaled(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  if (factor === 1) return canvas;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * factor));
  out.height = Math.max(1, Math.round(canvas.height * factor));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * Encode le canvas en restant sous `limit`, du plus fidèle au plus léger.
 *
 * Le parchemin est une texture photographique : en PNG il pèse près de 3 Mo,
 * en JPEG dix fois moins pour un rendu qu'on ne distingue pas à l'œil. Un fond
 * transparent, lui, ne peut pas partir en JPEG : on reste en PNG, et le WebP
 * sert de repli s'il faut vraiment gagner du poids sans perdre l'alpha.
 *
 * On descend la qualité d'abord, la taille ensuite : mieux vaut une carte
 * pleine résolution un peu compressée qu'une carte nette mais illisible.
 */
async function encodeUnder(
  canvas: HTMLCanvasElement,
  limit: number,
  transparent: boolean
): Promise<ExportResult> {
  const ladder: Array<{ type: string; quality?: number }> = transparent
    ? [{ type: 'image/png' }, ...QUALITY_STEPS.map((quality) => ({ type: 'image/webp', quality }))]
    : QUALITY_STEPS.map((quality) => ({ type: 'image/jpeg', quality }));

  let last: { blob: Blob; canvas: HTMLCanvasElement } | null = null;
  for (const factor of SCALE_STEPS) {
    const target = scaled(canvas, factor);
    for (const { type, quality } of ladder) {
      const blob = await toBlob(target, type, quality);
      // Un navigateur qui ne sait pas encoder ce type renvoie du PNG sans le
      // dire : on ne garde que ce qu'on a vraiment demandé.
      if (!blob || blob.type !== type) continue;
      last = { blob, canvas: target };
      if (blob.size <= limit) {
        return {
          blob,
          extension: EXTENSIONS[blob.type] ?? 'png',
          width: target.width,
          height: target.height,
          downscaled: factor !== 1,
        };
      }
    }
  }

  // Rien n'est passé sous la limite : on rend la plus légère plutôt que rien,
  // l'appelant dira son poids et l'utilisatrice tranchera.
  if (!last) throw new Error("Ce navigateur n'a pas su encoder l'image");
  return {
    blob: last.blob,
    extension: EXTENSIONS[last.blob.type] ?? 'png',
    width: last.canvas.width,
    height: last.canvas.height,
    downscaled: true,
  };
}

export async function renderMapImage(req: ExportRequest): Promise<ExportResult> {
  const limit = req.maxBytes ?? DEFAULT_MAX_BYTES;
  const layers = [req.ground, ...req.overlays];
  const items = layers.flat().filter((item) => localAsset(item.href));
  if (items.length === 0) throw new Error('Aucun calque à exporter');

  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxY = Math.max(...items.map((i) => i.y));
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const tile = Math.max(
    1,
    Math.floor(
      req.tile *
        Math.min(
          1,
          MAX_CANVAS_SIDE / (Math.max(cols, rows) * req.tile),
          Math.sqrt(MAX_CANVAS_AREA / (cols * rows * req.tile * req.tile))
        )
    )
  );
  const mapWidth = cols * tile;
  const mapHeight = rows * tile;

  const sources = [...new Set(items.map((i) => localAsset(i.href)!))];
  const sprites = new Map<string, HTMLImageElement | null>(
    await Promise.all(
      sources.map(async (src) => [src, await loadImage(src)] as [string, HTMLImageElement | null])
    )
  );

  const map = document.createElement('canvas');
  map.width = mapWidth;
  map.height = mapHeight;
  const mapCtx = map.getContext('2d');
  if (!mapCtx) throw new Error('Canvas indisponible');

  layers.forEach((layer, index) => {
    const isGround = index === 0;
    for (const item of layer) {
      const sprite = sprites.get(localAsset(item.href) ?? '');
      if (!sprite) continue;
      mapCtx.globalAlpha =
        (item.opacity ?? 1) * (isGround && req.fadeGround ? FADED_GROUND : 1);
      // Y inversé : le nord du jeu (y croissant) doit se lire en haut.
      mapCtx.drawImage(
        sprite,
        (item.x - minX) * tile,
        (maxY - item.y) * tile,
        tile * (item.w ?? 1),
        tile * (item.h ?? 1)
      );
    }
  });
  mapCtx.globalAlpha = 1;

  if (req.background === 'none') return encodeUnder(map, limit, true);

  if (req.background === 'paper') {
    const paper = document.createElement('canvas');
    paper.width = mapWidth;
    paper.height = mapHeight;
    const paperCtx = paper.getContext('2d');
    if (!paperCtx) throw new Error('Canvas indisponible');
    paperCtx.fillStyle = PARCHMENT_FALLBACK;
    paperCtx.fillRect(0, 0, mapWidth, mapHeight);
    paperCtx.drawImage(map, 0, 0);
    return encodeUnder(paper, limit, false);
  }

  // Le parchemin du jeu est à l'italienne. Un plan tout en hauteur y flotterait
  // entre deux marges vides : on tourne la feuille d'un quart de tour.
  const portrait = mapHeight > mapWidth;
  const sheetWidth = (portrait ? PARCHMENT_SIZE.height : PARCHMENT_SIZE.width) * SHEET_SCALE;
  const sheetHeight = (portrait ? PARCHMENT_SIZE.width : PARCHMENT_SIZE.height) * SHEET_SCALE;

  const sheet = document.createElement('canvas');
  sheet.width = sheetWidth;
  sheet.height = sheetHeight;
  const ctx = sheet.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');

  const parchment = await loadParchment();
  if (parchment) {
    if (portrait) {
      ctx.save();
      ctx.translate(sheetWidth / 2, sheetHeight / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(parchment, -sheetHeight / 2, -sheetWidth / 2, sheetHeight, sheetWidth);
      ctx.restore();
    } else {
      ctx.drawImage(parchment, 0, 0, sheetWidth, sheetHeight);
    }
  } else {
    ctx.fillStyle = PARCHMENT_FALLBACK;
    ctx.fillRect(0, 0, sheetWidth, sheetHeight);
  }

  const ratio = Math.min(
    (sheetWidth * (1 - 2 * MARGIN)) / mapWidth,
    (sheetHeight * (1 - 2 * MARGIN)) / mapHeight
  );
  const drawWidth = mapWidth * ratio;
  const drawHeight = mapHeight * ratio;
  ctx.drawImage(map, (sheetWidth - drawWidth) / 2, (sheetHeight - drawHeight) / 2, drawWidth, drawHeight);

  return encodeUnder(sheet, limit, false);
}

/** "1,4 Mo", "812 ko" : le poids tel qu'on le lit dans un message d'erreur. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} ko`;
  return `${(bytes / (1000 * 1000)).toFixed(1).replace('.', ',')} Mo`;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
