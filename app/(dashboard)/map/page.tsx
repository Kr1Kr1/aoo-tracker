"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  localAsset,
  isTeleport,
  renderMapImage,
  downloadBlob,
  formatBytes,
  type ExportItem,
} from "@/lib/mapExport";

// `owner` is the persona (AOM targetId) that revealed the cell: null/positive
// = canon (a PJ, e.g. medarda), negative = a PNJ whose layer is opt-in.
interface Owned { owner?: number | null }
interface Tile extends Owned { x: number; y: number; name: string; href: string | null; foreground?: number }
// w/h : étendue en cases d'une image composée (bâtiment 2×2), ancrée en haut à gauche.
interface Wall extends Owned { x: number; y: number; name: string; href: string | null; w?: number; h?: number }
// edge/half : fondu d'un élément animé (eau, lave…), voir ElementEdgeDefs.
interface Element extends Owned { x: number; y: number; name: string; href: string | null; opacity?: number; w?: number; h?: number; edge?: number; half?: string | null }
interface Foreground extends Owned { x: number; y: number; name: string; href: string | null; w?: number; h?: number }
interface Route extends Owned { x: number; y: number; name: string; href: string | null }
interface Plant extends Owned { x: number; y: number; name: string; href: string | null }
interface Player extends Owned { x: number; y: number; targetId: number; name: string; href: string | null; portraitUrl: string | null; color: string | null; faction: string | null }
interface PersonaLayer { targetId: number; name: string }

interface MapData {
  plan: string;
  z: number;
  personaLayers: PersonaLayer[];
  tiles: Tile[];
  walls: Wall[];
  elements: Element[];
  foregrounds: Foreground[];
  routes: Route[];
  plants: Plant[];
  players: Player[];
}

interface ZLevel {
  z: number;
  zName: string | null;
  /** Per-z backdrop scraped from the SVG (e.g. img/tiles/sky.webp). */
  bg?: string | null;
  /** True when this z-level has at least one scraped Coords row. */
  hasData?: boolean;
  visibleBoundsMinX: number | null;
  visibleBoundsMaxX: number | null;
  visibleBoundsMinY: number | null;
  visibleBoundsMaxY: number | null;
}

interface PlanInfo {
  name: string;
  displayName: string;
  shortName?: string | null;
  worldX?: number | null;
  worldY?: number | null;
  visibleBoundsMinX: number | null;
  visibleBoundsMaxX: number | null;
  visibleBoundsMinY: number | null;
  visibleBoundsMaxY: number | null;
  zLevels: ZLevel[];
  exitsFrom: Array<{ direction: string; planTo: string }>;
  hasData: boolean;
  unknown?: boolean;
  /** Saison du plan ; null = toutes saisons (voir lib/season.ts). */
  season?: number | null;
  /** "img/tiles/<plan>.png" — engine paints this as a tiled CSS background. */
  bg?: string | null;
}

const TILE = 50;

// Fondu des éléments animés, repris du plateau du jeu : chaque bit de `edge`
// fond un bord sur 30 % de la case (1 N, 2 E, 4 S, 8 O) ou arrondit un coin
// sur 15 px (16 NE, 32 SE, 64 SO, 128 NO) ; `half` ne garde que la moitié de
// la case du côté du coin nommé (ESW = coin sud-est, WNE = nord-ouest…).
const EDGE_FADES: Array<{ bit: number; linear?: [number, number, number, number]; corner?: [number, number] }> = [
  { bit: 1, linear: [0, 0, 0, TILE] },
  { bit: 2, linear: [TILE, 0, 0, 0] },
  { bit: 4, linear: [0, TILE, 0, 0] },
  { bit: 8, linear: [0, 0, TILE, 0] },
  { bit: 16, corner: [TILE, 0] },
  { bit: 32, corner: [TILE, TILE] },
  { bit: 64, corner: [0, TILE] },
  { bit: 128, corner: [0, 0] },
];
const HALF_GRADIENTS: Record<string, [number, number, number, number]> = {
  ESW: [TILE, TILE, 0, 0],
  WNE: [0, 0, TILE, TILE],
  NES: [TILE, 0, 0, TILE],
  SWN: [0, TILE, TILE, 0],
};
const edgeMaskId = (edge = 0, half?: string | null) =>
  edge || (half && HALF_GRADIENTS[half]) ? `aoo-edge-${edge}-${half && HALF_GRADIENTS[half] ? half : ""}` : null;

function ElementEdgeDefs({ items }: { items: Array<{ edge?: number; half?: string | null }> }) {
  const combos = new Map<string, { edge: number; half: string | null }>();
  for (const item of items) {
    const id = edgeMaskId(item.edge, item.half);
    if (id && !combos.has(id)) {
      combos.set(id, { edge: item.edge ?? 0, half: item.half && HALF_GRADIENTS[item.half] ? item.half : null });
    }
  }
  if (combos.size === 0) return null;
  return (
    <defs>
      {EDGE_FADES.map(({ bit, linear, corner }) =>
        linear ? (
          <linearGradient key={bit} id={`aoo-fade-${bit}`} gradientUnits="userSpaceOnUse"
            x1={linear[0]} y1={linear[1]} x2={linear[2]} y2={linear[3]}>
            <stop offset={0} stopColor="#000" />
            <stop offset={0.3} stopColor="#000" stopOpacity={0} />
          </linearGradient>
        ) : (
          <radialGradient key={bit} id={`aoo-fade-${bit}`} gradientUnits="userSpaceOnUse"
            cx={corner![0]} cy={corner![1]} r={15}>
            <stop offset={0} stopColor="#000" />
            <stop offset={1} stopColor="#000" stopOpacity={0} />
          </radialGradient>
        )
      )}
      {Object.entries(HALF_GRADIENTS).map(([half, [x1, y1, x2, y2]]) => (
        <linearGradient key={half} id={`aoo-half-${half}`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
          <stop offset={0.35} stopColor="#fff" />
          <stop offset={0.65} stopColor="#000" />
        </linearGradient>
      ))}
      {[...combos].map(([id, { edge, half }]) => (
        <mask key={id} id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={TILE} height={TILE}>
          <rect width={TILE} height={TILE} fill={half ? `url(#aoo-half-${half})` : "#fff"} />
          {EDGE_FADES.filter(({ bit }) => edge & bit).map(({ bit }) => (
            <rect key={bit} width={TILE} height={TILE} fill={`url(#aoo-fade-${bit})`} />
          ))}
        </mask>
      ))}
    </defs>
  );
}

// Default z-level to open a plan on. Blindly using zLevels[0] lands on the
// lowest declared z — often an empty deep underground level (e.g.
// praetorium_s2 z=-6 "Galeries souterraines") so the plan looks empty even
// though its data is at z=0 ("Ville"). Prefer a z that actually has scraped
// data, favouring the ground level (z=0) then the level closest to it.
function pickDefaultZ(plan: PlanInfo | undefined): number {
  if (!plan || plan.zLevels.length === 0) return 0;
  const withData = plan.zLevels.filter((zl) => zl.hasData);
  const pool = withData.length > 0 ? withData : plan.zLevels;
  const ground = pool.find((zl) => zl.z === 0);
  if (ground) return ground.z;
  return [...pool].sort((a, b) => Math.abs(a.z) - Math.abs(b.z))[0].z;
}

export default function MapPage() {
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);
  // Saison affichée : celle en cours par défaut, une archive sur demande.
  const [viewSeason, setViewSeason] = useState<number | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [selectedZ, setSelectedZ] = useState<number>(0);
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  type MeLocation = {
    targetId: number;
    characterName: string;
    plan: string;
    z: number;
    x: number;
    y: number;
  };
  const [meLocation, setMeLocation] = useState<MeLocation | null>(null);

  // Load plan list + the active character's last known location once.
  // Selection priority: (1) the last plan/z the user was viewing — persisted
  // in localStorage so a refresh keeps you where you were; (2) where the
  // active character is right now; (3) the first plan that has data.
  useEffect(() => {
    Promise.all([
      fetch("/api/plans").then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ plans: PlanInfo[]; currentSeason: number }>;
      }),
      fetch("/api/me").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([plansResp, me]) => {
        setPlans(plansResp.plans);
        const current = plansResp.currentSeason;
        setCurrentSeason(current);
        setViewSeason(current);
        const playerLoc: MeLocation | null = me?.location ?? null;
        setMeLocation(playerLoc);
        const seasonOf = (p: PlanInfo) => p.season ?? current;

        // (1) Restore the last view the user had open — only if it was saved
        // with its season: a view saved before the season change points at
        // what is now an archive, and the new season should open fresh.
        let saved: { plan?: string; z?: number; season?: number } | null = null;
        try {
          const raw = localStorage.getItem("map:lastView");
          if (raw) saved = JSON.parse(raw);
        } catch {}
        const savedPlan =
          saved?.plan && plansResp.plans.find((p) => p.name === saved!.plan && seasonOf(p) === saved!.season);
        if (savedPlan) {
          setViewSeason(seasonOf(savedPlan));
          setSelectedPlan(savedPlan.name);
          const zOk = savedPlan.zLevels.some((zl) => zl.z === saved!.z);
          setSelectedZ(zOk ? saved!.z! : pickDefaultZ(savedPlan));
          return;
        }

        // (2) Where the active character is, if it's on a current-season plan.
        const playerPlan =
          playerLoc &&
          plansResp.plans.find((p) => p.name === playerLoc.plan && p.hasData && seasonOf(p) === current);
        if (playerPlan) {
          setSelectedPlan(playerPlan.name);
          setSelectedZ(
            playerPlan.zLevels.find((zl) => zl.z === playerLoc!.z)?.z ??
              pickDefaultZ(playerPlan)
          );
          return;
        }

        // (3) First current-season plan, with data if any.
        const inSeason = plansResp.plans.filter((p) => seasonOf(p) === current);
        const first = inSeason.find((p) => p.hasData) || inSeason[0];
        if (first) {
          setSelectedPlan(first.name);
          setSelectedZ(pickDefaultZ(first));
        } else {
          setLoading(false);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  // Remember the current plan/z so a refresh (or navigating back to /map)
  // reopens the same view instead of snapping to the character's location.
  useEffect(() => {
    if (!selectedPlan) return;
    try {
      localStorage.setItem(
        "map:lastView",
        JSON.stringify({ plan: selectedPlan, z: selectedZ, season: viewSeason })
      );
    } catch {}
  }, [selectedPlan, selectedZ, viewSeason]);

  // Load map data when plan/z change
  useEffect(() => {
    if (!selectedPlan) return;
    setLoading(true);
    fetch(`/api/maps?plan=${encodeURIComponent(selectedPlan)}&z=${selectedZ}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: MapData) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedPlan, selectedZ]);

  const currentPlan = plans.find((p) => p.name === selectedPlan);
  const currentZLevel = currentPlan?.zLevels.find((zl) => zl.z === selectedZ);

  // Une saison à la fois dans le menu : les archives (olympia_s2…) portent
  // le même nom affiché que les plans en cours, les mêler rendrait le menu
  // illisible. Un plan sans saison vaut pour la saison en cours.
  const visiblePlans = useMemo(
    () => plans.filter((p) => (p.season ?? currentSeason) === viewSeason),
    [plans, currentSeason, viewSeason]
  );
  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const p of plans) {
      const season = p.season ?? currentSeason;
      if (season != null) set.add(season);
    }
    if (currentSeason != null) set.add(currentSeason);
    return [...set].sort((x, y) => y - x);
  }, [plans, currentSeason]);

  // Not every plan has a real ground bg image: seedPlans falls back to a
  // guessed `img/tiles/<plan>.png` that often doesn't exist (e.g. olympia,
  // a fully tile-painted world map). Painting a <pattern> whose <image> 404s
  // makes the browser tile its broken-image placeholder across the whole
  // canvas. Probe the bg first and only paint it once it actually loads.
  // Prefer the per-z backdrop the extension actually scraped (e.g. sky.webp on
  // the Remparts) over the guessed per-plan bg. The scraped one is correct for
  // any z. currentPlan.bg is a *ground* texture guess (defaults to
  // img/tiles/<plan>.png, so it's always truthy) — it must never win at z > 0
  // just because it's set, or the sky.webp fallback below is dead code: en
  // hauteur (z > 0) sans backdrop scrapé, ça retombe sur img/tiles/sky.webp,
  // exactement le motif que l'engine peint lui-même en l'air.
  const bgHref = currentZLevel?.bg
    ? localAsset(currentZLevel.bg)
    : selectedZ > 0
      ? localAsset("img/tiles/sky.webp")
      : selectedZ === 0 && currentPlan?.bg
        ? localAsset(currentPlan.bg)
        : null;
  const [bgLoaded, setBgLoaded] = useState<string | null>(null);
  useEffect(() => {
    setBgLoaded(null);
    if (!bgHref) return;
    const img = new window.Image();
    img.onload = () => setBgLoaded(bgHref);
    img.src = bgHref;
    return () => {
      img.onload = null;
    };
  }, [bgHref]);

  // Plan-level extent (the full canvas as defined by the engine).
  const planExtent = useMemo(() => {
    const z = currentZLevel;
    const p = currentPlan;
    return {
      minX: z?.visibleBoundsMinX ?? p?.visibleBoundsMinX ?? null,
      maxX: z?.visibleBoundsMaxX ?? p?.visibleBoundsMaxX ?? null,
      minY: z?.visibleBoundsMinY ?? p?.visibleBoundsMinY ?? null,
      maxY: z?.visibleBoundsMaxY ?? p?.visibleBoundsMaxY ?? null,
    };
  }, [currentPlan, currentZLevel]);

  // Per-PNJ vision overlays. Canon (owner null/positive) is always shown; a
  // PNJ's cells appear only when its targetId is toggled on here — so a PNJ's
  // cartography never pollutes the main PJ's (medarda's) default view.
  const [visiblePersonas, setVisiblePersonas] = useState<Set<number>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);
  const prevPersonasRef = useRef<Set<number>>(new Set());
  const togglePersona = (targetId: number) =>
    setVisiblePersonas((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
  const isOwnerVisible = (owner?: number | null) =>
    owner == null || owner >= 0 || visiblePersonas.has(owner);

  // Map data filtered to the currently-visible personas. Drives bounds,
  // counts and rendering so hidden PNJ cells don't stretch the canvas.
  const visibleData = useMemo<MapData | null>(() => {
    if (!data) return null;
    const f = <T extends Owned>(rows: T[]) => rows.filter((r) => isOwnerVisible(r.owner));
    return {
      ...data,
      tiles: f(data.tiles),
      walls: f(data.walls),
      elements: f(data.elements),
      foregrounds: f(data.foregrounds),
      routes: f(data.routes),
      plants: f(data.plants),
      players: f(data.players),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visiblePersonas]);

  // What's actually been scraped at this plan/z.
  const observedExtent = useMemo(() => {
    const items = visibleData
      ? [...visibleData.tiles, ...visibleData.walls, ...visibleData.elements, ...visibleData.foregrounds, ...visibleData.routes, ...visibleData.plants, ...visibleData.players]
      : [];
    if (items.length === 0) return null;
    return {
      minX: Math.min(...items.map((e) => e.x)),
      maxX: Math.max(...items.map((e) => e.x)),
      minY: Math.min(...items.map((e) => e.y)),
      maxY: Math.max(...items.map((e) => e.y)),
    };
  }, [visibleData]);

  // Default render bounds: observed (+ 2 tile padding) so the user actually
  // sees their data instead of a tiny dot in a huge plan canvas. Toggle to
  // see the full plan extent if scraped enough of it.
  const [renderMode, setRenderMode] = useState<"observed" | "plan">("observed");
  const [zoom, setZoom] = useState(1);
  const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
  const ZOOM_MIN = ZOOM_STEPS[0];
  const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  const stepZoom = (dir: 1 | -1) =>
    setZoom((z) => {
      const idx = ZOOM_STEPS.findIndex((s) => Math.abs(s - z) < 1e-3);
      const nextIdx =
        idx === -1
          ? ZOOM_STEPS.findIndex((s) => s >= z)
          : Math.min(Math.max(idx + dir, 0), ZOOM_STEPS.length - 1);
      return ZOOM_STEPS[nextIdx === -1 ? ZOOM_STEPS.length - 1 : nextIdx];
    });
  const [layers, setLayers] = useState({
    tiles: true,
    routes: true,
    walls: true,
    elements: true,
    // Les téléporteurs sont des éléments (`flag_red`), pas une table à part :
    // ils ont leur case à cocher parce qu'ils bordent les plans et mangent la
    // lecture d'une carte qu'on veut donner à voir.
    tp: true,
    plants: true,
    foregrounds: true,
    players: true,
  });
  // Ordre d'affichage + libellés FR alignés sur la nomenclature de map.php
  // (data-table="…" côté moteur). L'ordre suit la pile de rendu en jeu :
  // sol → routes → murs → éléments → plantes → premier-plan → joueurs.
  const LAYER_LABELS: Array<{ key: keyof typeof layers; label: string }> = [
    { key: "tiles", label: "Sol" },
    { key: "routes", label: "Routes" },
    { key: "walls", label: "Murs" },
    { key: "elements", label: "Éléments" },
    { key: "tp", label: "Téléporteurs" },
    { key: "plants", label: "Plantes" },
    { key: "foregrounds", label: "Premier plan" },
    { key: "players", label: "Joueurs" },
  ];
  const toggleLayer = (key: keyof typeof layers) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  // Les éléments moins les téléporteurs quand la case est décochée. Sert au
  // rendu comme à l'export : on exporte ce qu'on voit.
  const shownElements = useMemo(() => {
    if (!visibleData) return [];
    return layers.tp ? visibleData.elements : visibleData.elements.filter((e) => !isTeleport(e));
  }, [visibleData, layers.tp]);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportBackground, setExportBackground] = useState<"parchment" | "paper" | "none">("parchment");
  const [exportFade, setExportFade] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState<string | null>(null);

  async function runExport() {
    if (!visibleData) return;
    setExporting(true);
    setExportError(null);
    setExportDone(null);
    try {
      const on = (rows: ExportItem[], visible: boolean) => (visible ? rows : []);
      const image = await renderMapImage({
        tile: TILE,
        ground: on(visibleData.tiles, layers.tiles),
        overlays: [
          on(visibleData.routes, layers.routes),
          on(visibleData.walls, layers.walls),
          on(shownElements, layers.elements),
          on(visibleData.plants, layers.plants),
          on(visibleData.foregrounds, layers.foregrounds),
        ],
        background: exportBackground,
        fadeGround: exportFade,
      });
      downloadBlob(image.blob, `carte-${selectedPlan}-z${selectedZ}.${image.extension}`);
      setExportDone(
        `${formatBytes(image.blob.size)}, ${image.width}×${image.height} px` +
          (image.downscaled ? " (réduite pour tenir sous la limite d'envoi)" : "")
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export impossible");
    } finally {
      setExporting(false);
    }
  }
  const bounds = useMemo(() => {
    if (renderMode === "plan" && planExtent.minX != null) {
      return {
        minX: planExtent.minX!, maxX: planExtent.maxX!,
        minY: planExtent.minY!, maxY: planExtent.maxY!,
      };
    }
    if (observedExtent) {
      const pad = 2;
      return {
        minX: observedExtent.minX - pad,
        maxX: observedExtent.maxX + pad,
        minY: observedExtent.minY - pad,
        maxY: observedExtent.maxY + pad,
      };
    }
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }, [renderMode, planExtent, observedExtent]);

  // A PNJ's cartography can sit anywhere in a huge, sparse plan (e.g. a whole
  // continent apart from the canon cluster) — toggling its layer on can grow
  // the canvas without the newly-revealed cells ever entering the viewport,
  // making the layer look empty even though it rendered. Jump to it.
  useEffect(() => {
    const prevVisible = prevPersonasRef.current;
    const addedId = [...visiblePersonas].find((id) => !prevVisible.has(id));
    prevPersonasRef.current = new Set(visiblePersonas);
    if (addedId == null || !data || !svgRef.current) return;
    const cells = [
      ...data.tiles, ...data.walls, ...data.elements,
      ...data.foregrounds, ...data.routes, ...data.plants, ...data.players,
    ].filter((r) => r.owner === addedId);
    if (cells.length === 0) return;
    const cx = cells.reduce((sum, c) => sum + c.x, 0) / cells.length;
    const cy = cells.reduce((sum, c) => sum + c.y, 0) / cells.length;
    const targetX = (cx - bounds.minX) * TILE;
    const targetY = (bounds.maxY - cy) * TILE;
    // A synthetic SVG child (rather than window.scrollTo, whose target box
    // isn't the actual scrolling ancestor in this layout) so scrollIntoView
    // walks up whatever the real scrollable ancestor turns out to be, in
    // viewBox units so it lands right regardless of the current zoom.
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    marker.setAttribute("x", String(targetX - TILE / 2));
    marker.setAttribute("y", String(targetY - TILE / 2));
    marker.setAttribute("width", String(TILE));
    marker.setAttribute("height", String(TILE));
    marker.setAttribute("fill", "none");
    svgRef.current.appendChild(marker);
    marker.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    setTimeout(() => marker.remove(), 1000);
  }, [visiblePersonas, data, bounds]);

  if (error) return <div className="p-8 text-red-600">Error: {error}</div>;
  if (plans.length === 0) {
    return (
      <div className="p-8">
        <p>Aucun plan en base. Lance <code>pnpm seed-plans</code>.</p>
      </div>
    );
  }

  // Ground-level bg: the engine paints img/tiles/<plan>.png as a 50×50 tiled
  // CSS background on the city container (e.g. praetorium z=0). Individual
  // tile/wall/element rows then override on top. Keep z<0 black so the
  // underground still reads as "unlit", matching in-game.
  // Only paint the bg once the image has actually loaded (see bgLoaded above),
  // so a missing bg leaves the canvas clean instead of a broken-tile grid.
  const bgAsset = bgLoaded;

  const width = (bounds.maxX - bounds.minX + 1) * TILE;
  const height = (bounds.maxY - bounds.minY + 1) * TILE;
  const px = (x: number) => (x - bounds.minX) * TILE;
  // Flip Y so the rendering matches the in-game orientation: AOM's "north"
  // (higher y) should appear at the top of the SVG, but SVG coordinates
  // increase downward.
  const py = (y: number) => (bounds.maxY - y) * TILE;

  const renderImageLayer = (
    items: Array<{ x: number; y: number; href: string | null; opacity?: number; w?: number; h?: number; edge?: number; half?: string | null }>,
    layer: string
  ) =>
    items
      .map((item, i) => {
        const local = localAsset(item.href);
        if (!local) return null;
        // Élément fondu : le masque est dessiné en coordonnées de case (0 à
        // 50), d'où la petite <svg> posée sur la case.
        const mask = edgeMaskId(item.edge, item.half);
        if (mask) {
          return (
            <svg key={`${layer}-${item.x}-${item.y}-${i}`} x={px(item.x)} y={py(item.y)}
              width={TILE} height={TILE} overflow="hidden" style={{ pointerEvents: "none" }}>
              <image href={local} x={0} y={0} width={TILE} height={TILE}
                mask={`url(#${mask})`} style={{ opacity: item.opacity ?? 1 }} />
            </svg>
          );
        }
        return (
          <image
            key={`${layer}-${item.x}-${item.y}-${i}`}
            href={local}
            x={px(item.x)}
            y={py(item.y)}
            width={TILE * (item.w ?? 1)}
            height={TILE * (item.h ?? 1)}
            preserveAspectRatio="none"
            style={{ opacity: item.opacity ?? 1, pointerEvents: "none" }}
          />
        );
      })
      .filter(Boolean);

  return (
    <div className="flex flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => stepZoom(-1)}
            disabled={zoom <= ZOOM_MIN + 1e-3}
            className="px-2 py-1 hover:bg-muted disabled:opacity-40"
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="px-2 py-1 hover:bg-muted border-x tabular-nums"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => stepZoom(1)}
            disabled={zoom >= ZOOM_MAX - 1e-3}
            className="px-2 py-1 hover:bg-muted disabled:opacity-40"
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
        </div>
        <h1 className="text-2xl font-bold">Map</h1>

        <select
          value={viewSeason ?? ""}
          onChange={(e) => {
            const season = parseInt(e.target.value, 10);
            setViewSeason(season);
            const inSeason = plans.filter((p) => (p.season ?? currentSeason) === season);
            const first = inSeason.find((p) => p.hasData) || inSeason[0];
            setSelectedPlan(first?.name ?? "");
            setSelectedZ(pickDefaultZ(first));
            if (!first) setData(null);
          }}
          className="border rounded px-2 py-1 text-sm"
          aria-label="Saison"
        >
          {seasons.map((season) => (
            <option key={season} value={season}>
              Saison {season}
              {season === currentSeason ? " (en cours)" : " (archive)"}
            </option>
          ))}
        </select>

        <select
          value={selectedPlan}
          onChange={(e) => {
            const p = plans.find((pl) => pl.name === e.target.value);
            setSelectedPlan(e.target.value);
            setSelectedZ(pickDefaultZ(p));
          }}
          className="border rounded px-2 py-1 text-sm"
        >
          <optgroup label="Avec données">
            {visiblePlans
              .filter((p) => p.hasData)
              .map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName} {p.unknown ? "(?)" : ""}
                </option>
              ))}
          </optgroup>
          <optgroup label="Sans données (non explorés)">
            {visiblePlans
              .filter((p) => !p.hasData)
              .map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                </option>
              ))}
          </optgroup>
        </select>

        {currentPlan && currentPlan.zLevels.length > 0 && (
          <select
            value={selectedZ}
            onChange={(e) => setSelectedZ(parseInt(e.target.value, 10))}
            className="border rounded px-2 py-1 text-sm"
          >
            {currentPlan.zLevels.map((zl) => (
              <option key={zl.z} value={zl.z}>
                z={zl.z}{zl.zName ? ` (${zl.zName})` : ""}
              </option>
            ))}
          </select>
        )}

        <span className="text-sm text-muted-foreground">
          {visibleData ? `${visibleData.tiles.length + visibleData.walls.length + visibleData.elements.length + visibleData.foregrounds.length + visibleData.routes.length + visibleData.plants.length + visibleData.players.length} entités` : ""}
          {observedExtent && (
            <> · zone scrapée ({observedExtent.minX},{observedExtent.minY})→({observedExtent.maxX},{observedExtent.maxY})</>
          )}
          {planExtent.minX != null && (
            <> · plan ({planExtent.minX},{planExtent.minY})→({planExtent.maxX},{planExtent.maxY})</>
          )}
        </span>

        <div className="ml-auto inline-flex rounded border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setRenderMode("observed")}
            className={`px-3 py-1 ${renderMode === "observed" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
          >
            Zone scrapée
          </button>
          <button
            type="button"
            disabled={planExtent.minX == null}
            onClick={() => setRenderMode("plan")}
            className={`px-3 py-1 disabled:opacity-40 ${renderMode === "plan" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
          >
            Plan complet
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Grille
        </label>
      </div>

      <div className="rounded border bg-yellow-50 px-3 py-2 text-sm font-mono">
        <span className="text-muted-foreground">Position perso (DB) :</span>{" "}
        {meLocation ? (
          <>
            <strong>{meLocation.characterName}</strong> (#{meLocation.targetId})
            {" → "}
            carte=<code>{meLocation.plan}</code>{" "}
            z=<code>{meLocation.z}</code>{" "}
            x=<code>{meLocation.x}</code>{" "}
            y=<code>{meLocation.y}</code>
          </>
        ) : (
          <em>aucune position connue</em>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Calques :</span>
        {LAYER_LABELS.map(({ key, label }) => (
          <label key={key} className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => toggleLayer(key)}
            />
            {label}
          </label>
        ))}
        <button
          type="button"
          onClick={() =>
            setLayers({
              tiles: true, routes: true, walls: true, elements: true, tp: true,
              plants: true, foregrounds: true, players: true,
            })
          }
          className="ml-2 underline text-xs text-muted-foreground hover:text-foreground"
        >
          tout cocher
        </button>
        <button
          type="button"
          onClick={() =>
            setLayers({
              tiles: false, routes: false, walls: false, elements: false, tp: false,
              plants: false, foregrounds: false, players: false,
            })
          }
          className="underline text-xs text-muted-foreground hover:text-foreground"
        >
          tout décocher
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => setExportOpen((open) => !open)}
          aria-expanded={exportOpen}
          className="rounded border px-2 py-1 text-xs hover:bg-muted"
        >
          🖼️ Exporter l&apos;image
        </button>
        {exportOpen && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-dashed bg-muted/30 px-3 py-2 text-xs">
            <label className="inline-flex items-center gap-1">
              Fond
              <select
                value={exportBackground}
                onChange={(e) => setExportBackground(e.target.value as "parchment" | "paper" | "none")}
                className="rounded border bg-background px-1 py-0.5"
              >
                <option value="parchment">Parchemin</option>
                <option value="paper">Papier uni</option>
                <option value="none">Transparent</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={exportFade}
                disabled={exportBackground === "none"}
                onChange={() => setExportFade((v) => !v)}
              />
              Sol estompé
            </label>
            <button
              type="button"
              onClick={runExport}
              disabled={exporting || !visibleData}
              className="rounded border px-2 py-1 hover:bg-muted disabled:opacity-40"
            >
              {exporting ? "Export en cours…" : "Télécharger l'image"}
            </button>
            <span className="text-muted-foreground">
              Les calques cochés, recadrés sur ce qui a été arpenté. Décor seul : une carte qu&apos;on
              partage n&apos;a pas à dire qui était où, les joueurs ne sont jamais exportés. Le
              fichier est calibré pour passer la limite d&apos;envoi de 2 Mo. Transparent donne un
              PNG à fond vide, que beaucoup de forums et de messageries affichent en noir : papier
              uni évite ça sans la feuille de parchemin.
            </span>
            {exportDone && <span className="text-green-700">Fichier : {exportDone}</span>}
            {exportError && <span className="text-red-600">{exportError}</span>}
          </div>
        )}
      </div>

      {data && data.personaLayers && data.personaLayers.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Personas (PNJ) :</span>
          <label className="inline-flex items-center gap-1 text-muted-foreground">
            <input type="checkbox" checked readOnly disabled />
            Canon (medarda &amp; PJ)
          </label>
          {data.personaLayers.map((p) => (
            <label key={p.targetId} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={visiblePersonas.has(p.targetId)}
                onChange={() => togglePersona(p.targetId)}
              />
              <span className="inline-block h-2 w-2 rounded-sm border border-dashed" style={{ borderColor: "#d946ef" }} />
              {p.name} <span className="text-muted-foreground">(#{p.targetId})</span>
            </label>
          ))}
        </div>
      )}

      {currentPlan?.exitsFrom && currentPlan.exitsFrom.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <strong>Sorties :</strong>{" "}
          {currentPlan.exitsFrom.map((e, i) => (
            <span key={i}>
              {i > 0 && " · "}
              <button
                onClick={() => {
                  const target = plans.find((p) => p.name === e.planTo);
                  if (target) {
                    setSelectedPlan(target.name);
                    setSelectedZ(pickDefaultZ(target));
                  }
                }}
                className="underline hover:text-foreground"
              >
                {e.direction.toUpperCase()} → {plans.find((p) => p.name === e.planTo)?.displayName || e.planTo}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="overflow-auto rounded border bg-gray-50">
        {loading ? (
          <p className="p-8 text-muted-foreground">Loading…</p>
        ) : !visibleData || (visibleData.tiles.length + visibleData.walls.length + visibleData.elements.length + visibleData.foregrounds.length + visibleData.routes.length + visibleData.plants.length + visibleData.players.length) === 0 ? (
          <p className="p-8 text-muted-foreground">
            {data && (data.personaLayers?.length ?? 0) > 0
              ? "Rien à afficher : la vue canon est vide ici, active un calque persona ci-dessus pour voir sa cartographie."
              : "Aucune donnée pour ce plan / niveau. Va sur place dans le jeu et lance « Fetch Map » dans le popup."}
          </p>
        ) : (
          <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            width={width * zoom}
            height={height * zoom}
            viewBox={`0 0 ${width} ${height}`}
            style={{ minWidth: width * zoom, minHeight: height * zoom }}
          >
            {/* Underground (z < 0): the engine paints undefined cells black
                because the player can't see past the lit area. Mirror that
                here so the map looks like in-game. */}
            {selectedZ < 0 && (
              <rect x={0} y={0} width={width} height={height} fill="#000" />
            )}
            {/* Ground-level bg image, tiled 50×50 like the engine does on the
                city container (also carries the z > 0 sky.webp fallback set
                in bgHref above). */}
            {bgAsset && (
              <>
                <defs>
                  <pattern
                    id="plan-bg"
                    x={0}
                    y={0}
                    width={TILE}
                    height={TILE}
                    patternUnits="userSpaceOnUse"
                  >
                    <image href={bgAsset} x={0} y={0} width={TILE} height={TILE} />
                  </pattern>
                </defs>
                <rect x={0} y={0} width={width} height={height} fill="url(#plan-bg)" />
              </>
            )}
            {layers.tiles && renderImageLayer(visibleData.tiles, "tile")}
            {layers.routes && renderImageLayer(visibleData.routes, "route")}
            {layers.walls && renderImageLayer(visibleData.walls, "wall")}
            {layers.elements && <ElementEdgeDefs items={shownElements} />}
            {layers.elements && renderImageLayer(shownElements, "element")}
            {layers.plants && renderImageLayer(visibleData.plants, "plant")}
            {layers.foregrounds && renderImageLayer(visibleData.foregrounds, "fg")}

            {/* PNJ cells get a dashed magenta outline so it's obvious which
                part of the map is a PNJ overlay vs the canon PJ vision. */}
            {visibleData.tiles
              .filter((t) => t.owner != null && t.owner < 0)
              .map((t, i) => (
                <rect
                  key={`pnj-${t.x}-${t.y}-${i}`}
                  x={px(t.x)} y={py(t.y)} width={TILE} height={TILE}
                  fill="none" stroke="#d946ef" strokeWidth={1.5}
                  strokeDasharray="4 3" pointerEvents="none"
                />
              ))}

            {layers.players && visibleData.players.map((p) => {
              const local = localAsset(p.href) || localAsset(p.portraitUrl) || p.portraitUrl;
              return (
                <g key={`player-${p.targetId}-${p.x}-${p.y}`}>
                  <title>{p.name} ({p.targetId}){p.faction ? ` · ${p.faction}` : ""}</title>
                  {/* In-game color code: the engine's race-hint bgColor,
                      scraped per player; orange fallback when unknown. */}
                  <rect
                    x={px(p.x)} y={py(p.y)} width={TILE} height={TILE}
                    fill="none" stroke={p.color || "#ff9933"} strokeWidth={3}
                  />
                  {local && (
                    <image href={local} x={px(p.x)} y={py(p.y)} width={TILE} height={TILE} />
                  )}
                </g>
              );
            })}

            {showGrid &&
              Array.from({ length: bounds.maxX - bounds.minX + 1 }).flatMap((_, ix) =>
                Array.from({ length: bounds.maxY - bounds.minY + 1 }).map((__, iy) => {
                  const lx = ix + bounds.minX;
                  const ly = iy + bounds.minY;
                  return (
                    <g key={`grid-${lx}-${ly}`}>
                      <rect
                        x={px(lx)} y={py(ly)} width={TILE} height={TILE}
                        fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth={0.5}
                      />
                      <text
                        x={px(lx) + 2} y={py(ly) + 10} fontSize={8} fill="rgba(0,0,0,0.5)"
                      >
                        {lx},{ly}
                      </text>
                    </g>
                  );
                })
              )}
          </svg>
        )}
      </div>
    </div>
  );
}
