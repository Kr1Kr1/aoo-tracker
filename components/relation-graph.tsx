"use client";

import { useMemo, useState } from "react";
import type { RelationContact, RelationPair } from "@/lib/relations";

type Channel = "missives" | "forum" | "hrp" | "events";

const CHANNEL_LABEL: Record<Channel, string> = {
  missives: "Missives",
  forum: "Forums RP",
  hrp: "HRP",
  events: "Événements",
};

const TOP_CHOICES = [15, 30, 50, 0] as const;

const WIDTH = 1000;
const HEIGHT = 720;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
// The drawing only occupies the middle of the coordinate space; the viewBox is
// cropped to it so the card is not mostly empty margin.
const VIEW = { x: 55, y: 70, w: 890, h: 560 };
const MIN_RADIUS = 120;
const MAX_RADIUS = 290;
/** The ring is an ellipse: a full circle wastes the width of a wide card. */
const SQUASH = 0.78;

const round = (n: number) => Math.round(n * 100) / 100;

// Quadratic curve bulging away from the center, so a contact-to-contact link
// arcs around the middle of the graph instead of cutting through it.
function bow(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = mx - CX;
  const dy = my - CY;
  const length = Math.hypot(dx, dy) || 1;
  const push = 0.22 * Math.hypot(to.x - from.x, to.y - from.y);
  const cx = round(mx + (dx / length) * push);
  const cy = round(my + (dy / length) * push);
  return `M${from.x} ${from.y} Q${cx} ${cy} ${to.x} ${to.y}`;
}

type Placed = RelationContact & {
  score: number;
  angle: number;
  labelGap: number;
  x: number;
  y: number;
  r: number;
};
type Sector = { faction: string; count: number; x: number; y: number };

export function RelationGraph({
  center,
  contacts,
  pairs,
}: {
  center: { targetId: number; name: string; faction: string };
  contacts: RelationContact[];
  pairs: RelationPair[];
}) {
  const [channels, setChannels] = useState<Record<Channel, boolean>>({
    missives: true,
    forum: true,
    hrp: true,
    events: true,
  });
  const [top, setTop] = useState<number>(30);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const scored = useMemo(() => {
    const score = (c: RelationContact) =>
      (channels.missives ? c.missives : 0) +
      (channels.forum ? c.forum : 0) +
      (channels.hrp ? c.hrp : 0) +
      (channels.events ? c.events : 0);
    return contacts
      .map((c, index) => ({ ...c, score: score(c), index }))
      .filter((c) => c.score > 0 && (showUnresolved || !c.unresolved))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [contacts, channels, showUnresolved]);

  const kept = top === 0 ? scored : scored.slice(0, top);

  // Faction sectors: identity comes from position and label, never from hue,
  // so the graph never leans on a dozen barely-separable colors.
  // Coordinates are rounded: raw trig results serialize differently in Node and
  // in the browser, which React reports as a hydration mismatch.
  const layout = useMemo(() => {
    if (kept.length === 0) return { nodes: [] as Placed[], sectors: [] as Sector[] };
    const maxScore = kept[0].score;
    const factions = new Map<string, typeof kept>();
    for (const contact of kept) {
      const list = factions.get(contact.faction) || [];
      list.push(contact);
      factions.set(contact.faction, list);
    }
    const groups = [...factions.entries()].sort((a, b) => b[1].length - a[1].length);

    const nodes: Placed[] = [];
    const sectors: Sector[] = [];
    let angle = -Math.PI / 2;
    const gap = 0.14;
    const usable = Math.PI * 2 - gap * groups.length;
    for (const [faction, members] of groups) {
      const span = usable * (members.length / kept.length);
      members.forEach((contact, i) => {
        const t = members.length === 1 ? 0.5 : (i + 0.5) / members.length;
        const a = angle + span * t;
        const strength = Math.sqrt(contact.score / maxScore);
        const radius = MAX_RADIUS - strength * (MAX_RADIUS - MIN_RADIUS);
        nodes.push({
          ...contact,
          angle: round(a),
          // Alternating label distance: in a crowded sector, neighbouring
          // names step out at two different radii instead of stacking.
          labelGap: i % 2 === 0 ? 9 : 26,
          x: round(CX + Math.cos(a) * radius),
          y: round(CY + Math.sin(a) * radius * SQUASH),
          r: round(5 + strength * 11),
        });
      });
      const mid = angle + span / 2;
      sectors.push({
        faction,
        count: members.length,
        x: round(CX + Math.cos(mid) * (MAX_RADIUS + 52)),
        y: round(CY + Math.sin(mid) * (MAX_RADIUS + 40) * SQUASH),
      });
      angle += span + gap;
    }
    return { nodes, sectors };
  }, [kept]);

  const placed = layout.nodes;
  const labelled = useMemo(
    () => new Set(kept.slice(0, 20).map((c) => c.targetId)),
    [kept]
  );

  // Identity is the matricule: two characters can share a display name.
  const positionByTargetId = useMemo(
    () => new Map(placed.map((p) => [p.targetId, p])),
    [placed]
  );

  // Contact-to-contact links, restricted to the nodes actually on screen.
  const neighbourLinks = useMemo(() => {
    const idByIndex = contacts.map((c) => c.targetId);
    return pairs
      .filter(
        (p) =>
          p.weight >= 2 &&
          positionByTargetId.has(idByIndex[p.a]) &&
          positionByTargetId.has(idByIndex[p.b])
      )
      .slice(0, placed.length * 3)
      .map((p) => ({
        weight: p.weight,
        from: positionByTargetId.get(idByIndex[p.a])!,
        to: positionByTargetId.get(idByIndex[p.b])!,
      }));
  }, [pairs, contacts, placed, positionByTargetId]);

  const active = hovered ?? selected;
  const activeContact = active !== null ? placed.find((p) => p.targetId === active) : null;
  const maxScore = placed.length ? Math.max(...placed.map((p) => p.score)) : 1;

  const neighboursOfActive = useMemo(() => {
    if (!activeContact) return new Set<number>();
    const ids = new Set<number>();
    for (const link of neighbourLinks) {
      if (link.from.targetId === activeContact.targetId) ids.add(link.to.targetId);
      if (link.to.targetId === activeContact.targetId) ids.add(link.from.targetId);
    }
    return ids;
  }, [activeContact, neighbourLinks]);

  const dim = (targetId: number) =>
    Boolean(activeContact) &&
    targetId !== activeContact!.targetId &&
    !neighboursOfActive.has(targetId);

  return (
    <div className="viz-root">
      {/* Light tokens only: the rest of the tracker has no dark theme, so a
          prefers-color-scheme switch here would repaint the graph alone. */}
      <style>{`
        .viz-root {
          --surface-1: #fcfcfb;
          --text-primary: #0b0b0b;
          --text-secondary: #52514e;
          --muted: #898781;
          --gridline: #e1e0d9;
          --axis: #c3c2b7;
          --series-1: #2a78d6;
        }
      `}</style>

      {/* One filter row above everything it scopes. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {(Object.keys(CHANNEL_LABEL) as Channel[]).map((channel) => (
          <button
            key={channel}
            type="button"
            aria-pressed={channels[channel]}
            onClick={() =>
              setChannels((prev) => ({ ...prev, [channel]: !prev[channel] }))
            }
            className={`rounded-full border px-3 py-1 transition-colors ${
              channels[channel]
                ? "border-transparent bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {CHANNEL_LABEL[channel]}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={showUnresolved}
            onChange={(e) => setShowUnresolved(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Profils non résolus
        </label>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-muted-foreground">Afficher</span>
        {TOP_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={top === choice}
            onClick={() => setTop(choice)}
            className={`rounded border px-2 py-0.5 transition-colors ${
              top === choice
                ? "border-transparent bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {choice === 0 ? `tous (${scored.length})` : `top ${choice}`}
          </button>
        ))}
      </div>

      <div className="mx-auto max-w-4xl rounded-lg border bg-white p-2">
        <svg
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Relations de ${center.name} avec ${placed.length} personnages`}
        >
          {/* Sector labels: the faction is read from where a node sits. */}
          {layout.sectors.map((sector) => (
            <text
              key={sector.faction}
              x={sector.x}
              y={sector.y}
              textAnchor="middle"
              fontSize={11}
              letterSpacing={0.4}
              fill="var(--muted)"
            >
              {sector.faction.toUpperCase()}
            </text>
          ))}

          {/* Neighbourhood links, hairline and recessive. Bowed away from the
              middle so they never get confused with links to the center. */}
          {neighbourLinks.map((link, i) => (
            <path
              key={`n${i}`}
              d={bow(link.from, link.to)}
              fill="none"
              stroke="var(--gridline)"
              strokeWidth={1}
              opacity={
                activeContact
                  ? link.from.targetId === activeContact.targetId ||
                    link.to.targetId === activeContact.targetId
                    ? 0.9
                    : 0.12
                  : 0.65
              }
            />
          ))}

          {/* Links to the center, width carries the volume of exchanges. */}
          {placed.map((contact) => (
            <line
              key={`c${contact.targetId}`}
              x1={CX}
              y1={CY}
              x2={contact.x}
              y2={contact.y}
              stroke="var(--series-1)"
              strokeWidth={round(1 + Math.sqrt(contact.score / maxScore) * 3)}
              opacity={dim(contact.targetId) ? 0.12 : 0.45}
            />
          ))}

          {placed.map((contact) => {
            const faded = dim(contact.targetId);
            return (
              <g
                key={contact.targetId}
                tabIndex={0}
                role="button"
                aria-label={`${contact.name}, ${contact.score} échanges`}
                onMouseEnter={() => setHovered(contact.targetId)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(contact.targetId)}
                onBlur={() => setHovered(null)}
                onClick={() =>
                  setSelected(selected === contact.targetId ? null : contact.targetId)
                }
                className="cursor-pointer outline-none"
                opacity={faded ? 0.25 : 1}
              >
                {/* Hit area, larger than the mark. */}
                <circle cx={contact.x} cy={contact.y} r={Math.max(16, contact.r + 8)} fill="transparent" />
                <circle
                  cx={contact.x}
                  cy={contact.y}
                  r={contact.r}
                  fill={contact.unresolved ? "var(--surface-1)" : "var(--series-1)"}
                  stroke={contact.unresolved ? "var(--axis)" : "var(--surface-1)"}
                  strokeWidth={2}
                />
              </g>
            );
          })}

          {/* Labels last, so a neighbouring node never paints over a name.
              Selective: the strongest contacts are named on the graph, the rest
              on hover or in the table. Pushed outward along the radius and
              haloed to stay legible over links. */}
          {placed
            .filter((c) => labelled.has(c.targetId) || active === c.targetId)
            .map((contact) => (
              <text
                key={`l${contact.targetId}`}
                x={round(contact.x + Math.cos(contact.angle) * (contact.r + contact.labelGap))}
                y={round(
                  contact.y + Math.sin(contact.angle) * (contact.r + contact.labelGap) + 4
                )}
                textAnchor={
                  Math.cos(contact.angle) > 0.3
                    ? "start"
                    : Math.cos(contact.angle) < -0.3
                      ? "end"
                      : "middle"
                }
                fontSize={12}
                fill="var(--text-secondary)"
                stroke="var(--surface-1)"
                strokeWidth={3}
                paintOrder="stroke"
                opacity={dim(contact.targetId) ? 0.25 : 1}
                pointerEvents="none"
              >
                {contact.name}
              </text>
            ))}

          {/* The center. */}
          <circle cx={CX} cy={CY} r={26} fill="var(--text-primary)" />
          <text
            x={CX}
            y={CY + 4}
            textAnchor="middle"
            fontSize={13}
            fontWeight={600}
            fill="var(--surface-1)"
          >
            {center.name}
          </text>
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#2a78d6" }} />
          Personnage avec fiche
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full border-2"
            style={{ borderColor: "#c3c2b7", background: "#fcfcfb" }}
          />
          Profil non résolu (jamais vu en fiche)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-6" style={{ background: "#e1e0d9" }} />
          Lien entre deux contacts (sujets partagés)
        </span>
        <span>Plus le lien est court et épais, plus les échanges sont nombreux.</span>
      </div>

      {activeContact && (
        <div className="mt-3 rounded-lg border bg-white p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="font-medium">{activeContact.name}</span>{" "}
              <span className="text-muted-foreground">
                · {activeContact.faction}
                {activeContact.unresolved && " · profil non résolu"}
              </span>
            </div>
            {!activeContact.unresolved && (
              <a
                href={`/characters/${activeContact.targetId}`}
                className="text-xs text-blue-700 hover:underline"
              >
                Voir la fiche →
              </a>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {activeContact.missives} en missives · {activeContact.forum} en forums RP ·{" "}
            {activeContact.hrp} en HRP · {activeContact.events} événements en jeu · dernier échange{" "}
            {activeContact.lastLabel}
            {activeContact.lastChannel && ` (${activeContact.lastChannel})`} ·{" "}
            {neighboursOfActive.size} lien{neighboursOfActive.size > 1 ? "s" : ""} dans l&apos;entourage
          </p>
        </div>
      )}

      {/* Table view: every value readable without hovering anything. */}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          Voir le tableau ({scored.length} personnages)
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1 pr-3 text-left font-medium">Personnage</th>
                <th className="py-1 pr-3 text-left font-medium">Faction</th>
                <th className="py-1 pr-3 text-right font-medium">Échanges</th>
                <th className="py-1 pr-3 text-right font-medium">Missives</th>
                <th className="py-1 pr-3 text-right font-medium">Forums RP</th>
                <th className="py-1 pr-3 text-right font-medium">HRP</th>
                <th className="py-1 pr-3 text-right font-medium">Jeu</th>
                <th className="py-1 pr-3 text-left font-medium">Dernier échange</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {scored.map((contact) => (
                <tr key={contact.targetId} className="border-b last:border-0">
                  <td className="py-1 pr-3">
                    {contact.name}
                    {contact.unresolved && (
                      <span className="ml-1 text-xs text-muted-foreground">(non résolu)</span>
                    )}
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">{contact.faction}</td>
                  <td className="py-1 pr-3 text-right font-medium">{contact.score}</td>
                  <td className="py-1 pr-3 text-right">{contact.missives}</td>
                  <td className="py-1 pr-3 text-right">{contact.forum}</td>
                  <td className="py-1 pr-3 text-right">{contact.hrp}</td>
                  <td className="py-1 pr-3 text-right">{contact.events}</td>
                  <td className="py-1 pr-3 text-muted-foreground">
                    {contact.lastLabel}
                    {contact.lastChannel && ` (${contact.lastChannel})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
