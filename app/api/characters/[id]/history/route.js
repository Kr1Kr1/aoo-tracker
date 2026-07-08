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

    const body = await request.json();
    const story = (body.story || "").trim();

    const character = await prisma.characters.findUnique({ where: { targetId } });
    if (!character) return errorResponse("Character not found", 404, origin);

    const mostRecent = await prisma.characterHistory.findFirst({
      where: { characterId: character.id },
      orderBy: { modifiedAt: "desc" },
    });
    if (mostRecent && mostRecent.story.trim() === story) {
      return jsonResponse(
        { code: "duplicate", message: "Story unchanged" },
        { status: 409, origin }
      );
    }

    const entry = await prisma.characterHistory.create({
      data: { characterId: character.id, story },
    });
    logger.info(`Story entry for ${character.name} (${targetId})`);
    return jsonResponse(entry, { origin });
  } catch (err) {
    logger.error(`Error updating story: ${err.message}`, { stack: err.stack });
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

    const history = await prisma.characterHistory.findMany({
      where: { characterId: character.id },
      orderBy: { modifiedAt: "desc" },
    });
    return jsonResponse(history, { origin });
  } catch (err) {
    logger.error(`Error fetching story history: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
