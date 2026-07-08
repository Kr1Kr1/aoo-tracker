"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, History, ChevronLeft, ChevronRight } from "lucide-react";

interface SnapshotLayer {
  layerKey: string;
  sourceHref: string;
  filePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zOrder: number;
}

interface Snapshot {
  id: number;
  capturedAt: string;
  svgWidth: number;
  svgHeight: number;
  playerId: number | null;
  layers: SnapshotLayer[];
}

const SPEEDS = [
  { label: "0.25x (2000ms)", value: 2000 },
  { label: "0.5x (1000ms)", value: 1000 },
  { label: "1x (500ms)", value: 500 },
  { label: "2x (250ms)", value: 250 },
];

const KNOWN_LAYERS = ["background", "coordinates", "players", "player"] as const;
type KnownLayer = (typeof KNOWN_LAYERS)[number];

function isoNow(): string {
  return new Date().toISOString();
}
function isoMinusHours(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function formatCapturedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function MapReplayPage() {
  const [frames, setFrames] = useState<Snapshot[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(500);
  const [from, setFrom] = useState(() => isoMinusHours(24));
  const [to, setTo] = useState(() => isoNow());
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    background: true,
    coordinates: true,
    players: true,
    player: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch frames whenever range changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL("/api/map-snapshots", window.location.origin);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("limit", "1000");
    fetch(url.toString(), { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Snapshot[];
      })
      .then((data) => {
        if (cancelled) return;
        setFrames(data);
        setIdx(data.length > 0 ? data.length - 1 : 0);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // Playback timer.
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    intervalRef.current = setInterval(() => {
      setIdx((i) => (i + 1) % frames.length);
    }, speedMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, speedMs, frames.length]);

  // Preload adjacent frames so scrubbing is smooth.
  useEffect(() => {
    if (frames.length === 0) return;
    for (let d = -3; d <= 4; d++) {
      const j = idx + d;
      if (j < 0 || j >= frames.length || j === idx) continue;
      for (const layer of frames[j].layers) {
        const img = new Image();
        img.src = layer.filePath;
      }
    }
  }, [idx, frames]);

  const current = frames[idx];
  const visibleLayers = useMemo(
    () => current?.layers.filter((l) => toggles[l.layerKey] ?? true) ?? [],
    [current, toggles]
  );

  const layerKeys = useMemo(() => {
    const set = new Set<string>();
    for (const f of frames) for (const l of f.layers) set.add(l.layerKey);
    return Array.from(set).sort();
  }, [frames]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <History className="w-5 h-5" />
        <h1 className="text-2xl font-bold">Map replay</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Début</span>
          <input
            type="datetime-local"
            value={from.slice(0, 16)}
            onChange={(e) => setFrom(new Date(e.target.value).toISOString())}
            className="border rounded px-2 py-1 bg-background"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Fin</span>
          <input
            type="datetime-local"
            value={to.slice(0, 16)}
            onChange={(e) => setTo(new Date(e.target.value).toISOString())}
            className="border rounded px-2 py-1 bg-background"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Vitesse</span>
          <select
            value={speedMs}
            onChange={(e) => setSpeedMs(parseInt(e.target.value, 10))}
            className="border rounded px-2 py-1 bg-background"
          >
            {SPEEDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 text-sm">
        {layerKeys.map((key) => (
          <label key={key} className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={toggles[key] ?? true}
              onChange={(e) =>
                setToggles((t) => ({ ...t, [key]: e.target.checked }))
              }
            />
            <span>{key}</span>
          </label>
        ))}
      </div>

      {loading && <p className="text-muted-foreground">Chargement…</p>}
      {error && <p className="text-red-500">Erreur : {error}</p>}
      {!loading && !error && frames.length === 0 && (
        <p className="text-muted-foreground">Aucune frame sur cette plage.</p>
      )}

      {current && (
        <>
          <div className="border rounded bg-stone-200 dark:bg-stone-800 flex items-center justify-center mb-4 overflow-auto">
            <svg
              width={current.svgWidth}
              height={current.svgHeight}
              style={{ display: "block" }}
              viewBox={`0 0 ${current.svgWidth} ${current.svgHeight}`}
            >
              {visibleLayers
                .slice()
                .sort((a, b) => a.zOrder - b.zOrder)
                .map((layer) => (
                  <image
                    key={`${current.id}-${layer.layerKey}-${layer.zOrder}`}
                    href={layer.filePath}
                    x={layer.x}
                    y={layer.y}
                    width={layer.width}
                    height={layer.height}
                  />
                ))}
            </svg>
          </div>

          <div className="flex items-center gap-3 mb-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={idx === 0}
              aria-label="Frame précédente"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIdx((i) => Math.min(frames.length - 1, i + 1))}
              disabled={idx === frames.length - 1}
              aria-label="Frame suivante"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="text-sm tabular-nums">
              {idx + 1} / {frames.length} · {formatCapturedAt(current.capturedAt)}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={idx}
            onChange={(e) => setIdx(parseInt(e.target.value, 10))}
            className="w-full"
          />
        </>
      )}
    </div>
  );
}
