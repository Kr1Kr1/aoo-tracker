import * as jose from "jose";
import { cookies } from "next/headers";
import prisma from "./prisma";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export interface CallerContext {
  userId: number;
  username: string;
  role: "user" | "admin";
  /** targetIds the user is linked to via the User↔Characters relation. */
  characterTargetIds: number[];
  /** Internal Characters.id values, useful for queries keyed on characterId. */
  characterIds: number[];
  /** Active "acting as" targetId, if the cookie points to a character the user owns. */
  actingAsTargetId: number | null;
}

function tokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)auth-token=([^;]+)/);
  const headerToken = request.headers.get("authorization")?.split(" ")[1];
  return cookieMatch?.[1] || headerToken || null;
}

function actingAsFromRequest(request: Request): number | null {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)acting-as=([^;]+)/);
  if (!match) return null;
  const parsed = parseInt(decodeURIComponent(match[1]), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function buildContext(token: string | null, actingAsRaw: number | null): Promise<CallerContext | null> {
  if (!token) return null;

  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(token, JWT_SECRET));
  } catch {
    return null;
  }

  const userId = payload.userId as number | undefined;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { characters: { select: { id: true, targetId: true } } },
  });
  if (!user) return null;

  const characterTargetIds = user.characters.map((c) => c.targetId);
  const characterIds = user.characters.map((c) => c.id);
  const role: "user" | "admin" = user.role === "admin" ? "admin" : "user";

  const actingAsTargetId =
    actingAsRaw != null && (role === "admin" || characterTargetIds.includes(actingAsRaw))
      ? actingAsRaw
      : null;

  return {
    userId: user.id,
    username: user.username,
    role,
    characterTargetIds,
    characterIds,
    actingAsTargetId,
  };
}

/** Use from API route handlers (`POST(request)`, etc.). */
export async function getCallerContext(request: Request): Promise<CallerContext | null> {
  return buildContext(tokenFromRequest(request), actingAsFromRequest(request));
}

/** Use from server components (`page.tsx`, `layout.tsx`). */
export async function getCallerContextFromCookies(): Promise<CallerContext | null> {
  const store = await cookies();
  const token = store.get("auth-token")?.value || null;
  const actingAsRaw = store.get("acting-as")?.value;
  const actingAs = actingAsRaw ? parseInt(actingAsRaw, 10) : null;
  return buildContext(token, Number.isNaN(actingAs) ? null : actingAs);
}

export function isAdmin(ctx: CallerContext | null): boolean {
  return ctx?.role === "admin";
}

/**
 * targetIds the caller may read/write.
 * - admin without acting-as → null (no filter)
 * - acting-as set → just that one targetId
 * - regular user → linked targetIds
 */
export function visibleTargetIds(ctx: CallerContext): number[] | null {
  if (ctx.role === "admin" && ctx.actingAsTargetId == null) return null;
  if (ctx.actingAsTargetId != null) return [ctx.actingAsTargetId];
  return ctx.characterTargetIds;
}

/** Same as visibleTargetIds but resolved to internal Characters.id values. */
export async function visibleCharacterIds(ctx: CallerContext): Promise<number[] | null> {
  if (ctx.role === "admin" && ctx.actingAsTargetId == null) return null;
  if (ctx.actingAsTargetId != null) {
    const character = await prisma.characters.findUnique({
      where: { targetId: ctx.actingAsTargetId },
      select: { id: true },
    });
    return character ? [character.id] : [];
  }
  return ctx.characterIds;
}

export function canAccessTargetId(ctx: CallerContext, targetId: number): boolean {
  if (ctx.role === "admin") return true;
  return ctx.characterTargetIds.includes(targetId);
}

/**
 * Resolves the caller and verifies they may act on `targetId`.
 * Returns the context on success, or a Response that should be returned
 * directly from the route handler.
 */
export async function requireCharacterAccess(
  request: Request,
  targetId: number,
  buildErrorResponse: (status: number, message: string) => Response
): Promise<CallerContext | Response> {
  const ctx = await getCallerContext(request);
  if (!ctx) return buildErrorResponse(401, "Unauthorized");
  if (!canAccessTargetId(ctx, targetId)) return buildErrorResponse(403, "Forbidden");
  return ctx;
}
