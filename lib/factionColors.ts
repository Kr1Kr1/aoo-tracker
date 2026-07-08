// Tailwind classes for the badge of each faction.
// Falls back to a neutral grey for unknown / missing factions.
const FACTION_COLORS: Record<string, string> = {
  "le royaume des cimes": "bg-amber-200 text-amber-800",
  "saruta & frères": "bg-yellow-200 text-yellow-800",
  "eryn dolen": "bg-green-200 text-green-800",
  "dieux": "bg-purple-200 text-purple-800",
  "la forge sacrée": "bg-red-200 text-red-800",
  "praetorium": "bg-orange-200 text-orange-800",
  "le tertre sauvage": "bg-emerald-200 text-emerald-800",
  "redoraan": "bg-rose-200 text-rose-800",
  "apatrides": "bg-gray-300 text-gray-800",
  "bahamut": "bg-indigo-200 text-indigo-800",
};

const DEFAULT_COLOR = "bg-gray-200 text-gray-800";

export function getFactionColor(faction: string | null | undefined): string {
  if (!faction) return DEFAULT_COLOR;
  return FACTION_COLORS[faction.toLowerCase()] ?? DEFAULT_COLOR;
}
