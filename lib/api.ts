// Shared helpers for API route handlers.

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3001",
  "https://age-of-olympia.net",
]);

export function corsHeaders(origin?: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "http://localhost:3001";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; origin?: string | null } = {}
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(init.origin) },
  });
}

export function errorResponse(message: string, status: number, origin?: string | null) {
  return jsonResponse({ error: message }, { status, origin });
}

export function preflight(origin?: string | null) {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function parseTargetId(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
