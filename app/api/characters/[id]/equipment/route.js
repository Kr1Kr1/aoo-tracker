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

// Upserts each equipment item by (characterId, gameId) so re-running the
// extension scrape doesn't pile up duplicate rows. Items without a gameId
// fall back to insert (Prisma allows multiple NULLs in a unique constraint).
export async function POST(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const targetId = parseTargetId(id);
    if (targetId === null) return errorResponse("Invalid targetId", 400, origin);

    const denied = await authorize(request, targetId, origin);
    if (denied) return denied;

    const body = await request.json();
    const items = Array.isArray(body.equipment) ? body.equipment : [body];
    if (items.length === 0) {
      return jsonResponse({ results: [], errors: [] }, { origin });
    }

    const character = await prisma.characters.findUnique({ where: { targetId } });
    if (!character) return errorResponse("Character not found", 404, origin);

    const results = [];
    const errors = [];

    for (const item of items) {
      const { id: gameId, name, description, type, price, imageUrl, thumbnailUrl } = item;
      if (!name || !type) {
        errors.push({ item, error: "Name and type are required" });
        continue;
      }

      const data = {
        gameId: gameId ?? null,
        name,
        description: description || "No description provided",
        type,
        price: price != null ? parseInt(price, 10) || null : null,
        imageUrl: imageUrl || null,
        thumbnailUrl: thumbnailUrl || null,
        characterId: character.id,
      };

      try {
        let entry;
        if (gameId) {
          entry = await prisma.equipment.upsert({
            where: { characterId_gameId: { characterId: character.id, gameId } },
            create: data,
            update: data,
          });
        } else {
          entry = await prisma.equipment.create({ data });
        }
        results.push(entry);
      } catch (err) {
        errors.push({ item, error: err.message });
        logger.error(`Equipment '${name}' failed for ${targetId}: ${err.message}`);
      }
    }

    logger.info(`Equipment for ${targetId}: ${results.length} ok, ${errors.length} errors`);
    return jsonResponse(
      { results, errors },
      { status: errors.length > 0 ? 207 : 200, origin }
    );
  } catch (err) {
    logger.error(`Error processing equipment: ${err.message}`, { stack: err.stack });
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

    const equipment = await prisma.equipment.findMany({
      where: { characterId: character.id },
      orderBy: { id: "asc" },
    });
    return jsonResponse(equipment, { origin });
  } catch (err) {
    logger.error(`Error fetching equipment: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
