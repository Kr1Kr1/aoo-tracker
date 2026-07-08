"use client";

import { useEffect, useState, useMemo } from "react";

// `owner` is the persona (AOM targetId) that revealed the cell: null/positive
// = canon (a PJ, e.g. medarda), negative = a PNJ whose layer is opt-in.
interface Owned { owner?: number | null }
interface Tile extends Owned { x: number; y: number; name: string; href: string | null; foreground?: number }
interface Wall extends Owned { x: number; y: number; name: string; href: string | null }
interface Element extends Owned { x: number; y: number; name: string; href: string | null; opacity?: number }
interface Foreground extends Owned { x: number; y: number; name: string; href: string | null }
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
  /** "img/tiles/<plan>.png" — engine paints this as a tiled CSS background. */
  bg?: string | null;
}

const TILE = 50;

function localAsset(href: string | null): string | null {
  if (!href) return null;
  const stripped = href
    .replace(/^https?:\/\/age-of-olympia\.net\//, "")
    .replace(/^\.?\//, "");
  if (!stripped.startsWith("img/")) return href;
  return `/assets/aom/${stripped}`;
}

export default function MapPage() {
  const [plans, setPlans] = useState<PlanInfo[]>([]);
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
        return r.json() as Promise<{ plans: PlanInfo[] }>;
      }),
      fetch("/api/me").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([plansResp, me]) => {
        setPlans(plansResp.plans);
        const playerLoc: MeLocation | null = me?.location ?? null;
        setMeLocation(playerLoc);

        // (1) Restore the last view the user had open.
        let saved: { plan?: string; z?: number } | null = null;
        try {
          const raw = localStorage.getItem("map:lastView");
          if (raw) saved = JSON.parse(raw);
        } catch {}
        const savedPlan = saved?.plan && plansResp.plans.find((p) => p.name === saved!.plan);
        if (savedPlan) {
          setSelectedPlan(savedPlan.name);
          const zOk = savedPlan.zLevels.some((zl) => zl.z === saved!.z);
          setSelectedZ(zOk ? saved!.z! : savedPlan.zLevels[0]?.z ?? 0);
          return;
        }

        // (2) Where the active character is.
        const playerPlan =
          playerLoc &&
          plansResp.plans.find((p) => p.name === playerLoc.plan && p.hasData);
        if (playerPlan) {
          setSelectedPlan(playerPlan.name);
          setSelectedZ(
            playerPlan.zLevels.find((zl) => zl.z === playerLoc!.z)?.z ??
              playerPlan.zLevels[0]?.z ?? 0
          );
          return;
        }

        // (3) First plan with data.
        const first = plansResp.plans.find((p) => p.hasData) || plansResp.plans[0];
        if (first) {
          setSelectedPlan(first.name);
          setSelectedZ(first.zLevels[0]?.z ?? 0);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  // Remember the current plan/z so a refresh (or navigating back to /map)
  // reopens the same view instead of snapping to the character's location.
  useEffect(() => {
    if (!selectedPlan) return;
    try {
      localStorage.setItem("map:lastView", JSON.stringify({ plan: selectedPlan, z: selectedZ }));
    } catch {}
  }, [selectedPlan, selectedZ]);

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

  // Not every plan has a real ground bg image: seedPlans falls back to a
  // guessed `img/tiles/<plan>.png` that often doesn't exist (e.g. olympia,
  // a fully tile-painted world map). Painting a <pattern> whose <image> 404s
  // makes the browser tile its broken-image placeholder across the whole
  // canvas. Probe the bg first and only paint it once it actually loads.
  // Prefer the per-z backdrop the extension actually scraped (e.g. sky.webp on
  // the Remparts) over the guessed per-plan bg. The scraped one is correct for
  // any z; the plan-level guess only applies at ground/above (z >= 0).
  const bgHref = currentZLevel?.bg
    ? localAsset(currentZLevel.bg)
    : currentPlan?.bg && selectedZ >= 0
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
    { key: "plants", label: "Plantes" },
    { key: "foregrounds", label: "Premier plan" },
    { key: "players", label: "Joueurs" },
  ];
  const toggleLayer = (key: keyof typeof layers) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
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
    items: Array<{ x: number; y: number; href: string | null; opacity?: number }>,
    layer: string
  ) =>
    items
      .map((item, i) => {
        const local = localAsset(item.href);
        if (!local) return null;
        return (
          <image
            key={`${layer}-${item.x}-${item.y}-${i}`}
            href={local}
            x={px(item.x)}
            y={py(item.y)}
            width={TILE}
            height={TILE}
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
          value={selectedPlan}
          onChange={(e) => {
            const p = plans.find((pl) => pl.name === e.target.value);
            setSelectedPlan(e.target.value);
            setSelectedZ(p?.zLevels[0]?.z ?? 0);
          }}
          className="border rounded px-2 py-1 text-sm"
        >
          <optgroup label="Avec données">
            {plans
              .filter((p) => p.hasData)
              .map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName} {p.unknown ? "(?)" : ""}
                </option>
              ))}
          </optgroup>
          <optgroup label="Sans données (non explorés)">
            {plans
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
              tiles: true, routes: true, walls: true, elements: true,
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
              tiles: false, routes: false, walls: false, elements: false,
              plants: false, foregrounds: false, players: false,
            })
          }
          className="underline text-xs text-muted-foreground hover:text-foreground"
        >
          tout décocher
        </button>
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
                    setSelectedZ(target.zLevels[0]?.z ?? 0);
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
                city container. */}
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
            {layers.elements && renderImageLayer(visibleData.elements, "element")}
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
                  {/* In-game color code: the engine's race-hint bgColor,
                      scraped per player; orange fallback when unknown. */}
                  <rect
                    x={px(p.x)} y={py(p.y)} width={TILE} height={TILE}
                    fill="none" stroke={p.color || "#ff9933"} strokeWidth={3}
                  />
                  {local && (
                    <image href={local} x={px(p.x)} y={py(p.y)} width={TILE} height={TILE}>
                      <title>{p.name} ({p.targetId}){p.faction ? ` · ${p.faction}` : ""}</title>
                    </image>
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
