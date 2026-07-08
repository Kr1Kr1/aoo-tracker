import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight, parseTargetId } from "@/lib/api";
import { getCallerContext, canAccessTargetId } from "@/lib/authContext";

async function authorize(request, targetId, origin) {
  const ctx = await getCallerContext(request);
  if (!ctx) return errorResponse("Unauthorized", 401, origin);
  if (!canAccessTargetId(ctx, targetId)) return errorResponse("Forbidden", 403, origin);
  return null;
}

export async function POST(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const targetId = parseTargetId(id);
    if (targetId === null) return errorResponse("Invalid targetId", 400, origin);

    const denied = await authorize(request, targetId, origin);
    if (denied) return denied;

    const { mdj, createdAt } = await request.json();
    if (!mdj || !mdj.trim()) {
      return errorResponse("Missing or empty MDJ content", 400, origin);
    }

    const character = await prisma.characters.findUnique({ where: { targetId } });
    if (!character) return errorResponse("Character not found", 404, origin);

    const trimmedMdj = mdj.trim();

    // Log-sourced entries pass an explicit timestamp so they line up with the
    // game's MDJ change date instead of when our extension ran. We dedup on
    // (mdj, createdAt) for those — the same MDJ logged twice on different
    // dates is two events. Live snapshots (no createdAt) only dedup against
    // the most recent stored MDJ.
    if (createdAt) {
      const at = new Date(createdAt);
      if (Number.isNaN(at.getTime())) {
        return errorResponse("Invalid createdAt", 400, origin);
      }
      const exists = await prisma.mDJHistory.findFirst({
        where: { characterId: character.id, mdj: trimmedMdj, createdAt: at },
      });
      if (exists) {
        return jsonResponse(
          { code: "duplicate", message: "MDJ already logged at this date" },
          { status: 409, origin }
        );
      }
      const entry = await prisma.mDJHistory.create({
        data: { characterId: character.id, mdj: trimmedMdj, createdAt: at },
      });
      logger.info(`MDJ entry (backdated) for ${character.name} (${targetId})`);
      return jsonResponse(entry, { origin });
    }

    const mostRecent = await prisma.mDJHistory.findFirst({
      where: { characterId: character.id },
      orderBy: { createdAt: "desc" },
    });
    if (mostRecent && mostRecent.mdj.trim() === trimmedMdj) {
      return jsonResponse(
        { code: "duplicate", message: "MDJ unchanged" },
        { status: 409, origin }
      );
    }

    const entry = await prisma.mDJHistory.create({
      data: { characterId: character.id, mdj: trimmedMdj },
    });
    logger.info(`MDJ entry for ${character.name} (${targetId})`);
    return jsonResponse(entry, { origin });
  } catch (err) {
    logger.error(`Error updating MDJ: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function GET(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const targetId = parseTargetId(id);
    if (targetId === null) return errorResponse("Invalid targetId", 400, origin);

    const denied = await authorize(request, targetId, origin);
    if (denied) return denied;

    const character = await prisma.characters.findUnique({ where: { targetId } });
    if (!character) return errorResponse("Character not found", 404, origin);

    const history = await prisma.mDJHistory.findMany({
      where: { characterId: character.id },
      orderBy: { createdAt: "desc" },
    });
    return jsonResponse(history, { origin });
  } catch (err) {
    logger.error(`Error fetching MDJ history: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
