import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight, parseTargetId } from "@/lib/api";
import { getCallerContext, canAccessTargetId } from "@/lib/authContext";

async function authorize(request, targetId) {
  const ctx = await getCallerContext(request);
  if (!ctx) return { error: errorResponse("Unauthorized", 401, request.headers.get("origin")) };
  if (!canAccessTargetId(ctx, targetId)) {
    return { error: errorResponse("Forbidden", 403, request.headers.get("origin")) };
  }
  return { ctx };
}

export async function GET(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const targetId = parseTargetId(id);
    if (targetId === null) return errorResponse("Invalid targetId", 400, origin);

    const { error } = await authorize(request, targetId);
    if (error) return error;

    const character = await prisma.characters.findUnique({
      where: { targetId },
      include: {
        faction: true,
        mdjHistory: { orderBy: { createdAt: "desc" }, take: 1 },
        storyHistory: { orderBy: { modifiedAt: "desc" }, take: 1 },
      },
    });
    if (!character) return errorResponse("Character not found", 404, origin);

    const response = {
      ...character,
      mostRecentMDJ:
        character.mdjHistory[0]?.mdj ||
        "Ce personnage est trop éloigné pour l'entendre parler.",
      mostRecentStory:
        character.storyHistory[0]?.story || "Je préfère garder cela pour moi.",
    };
    return jsonResponse(response, { origin });
  } catch (err) {
    logger.error(`Error fetching character: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function PATCH(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const targetId = parseTargetId(id);
    if (targetId === null) return errorResponse("Invalid targetId", 400, origin);

    const { error } = await authorize(request, targetId);
    if (error) return error;

    const updates = await request.json();
    const { rank, popularity, role, race } = updates;
    if (!rank && !popularity && !role && !race) {
      return errorResponse("No valid attributes to update", 400, origin);
    }

    const character = await prisma.characters.findUnique({ where: { targetId } });
    if (!character) return errorResponse("Character not found", 404, origin);

    const changeLogs = [];
    if (rank && rank !== character.rank) {
      changeLogs.push({ characterId: character.id, attribute: "rank", oldValue: character.rank, newValue: rank });
    }
    if (popularity && popularity !== character.popularity) {
      changeLogs.push({ characterId: character.id, attribute: "popularity", oldValue: character.popularity, newValue: popularity });
    }
    if (role && role !== character.role) {
      changeLogs.push({ characterId: character.id, attribute: "role", oldValue: character.role, newValue: role });
    }
    if (race && race !== character.race) {
      changeLogs.push({ characterId: character.id, attribute: "race", oldValue: character.race, newValue: race });
    }

    const updated = await prisma.characters.update({
      where: { targetId },
      data: { rank, popularity, role, race },
    });

    if (changeLogs.length > 0) {
      await prisma.characterLog.createMany({
        data: changeLogs.map((log) => ({ ...log, changedAt: new Date() })),
      });
    }

    logger.info(`Updated character ${updated.name} (${targetId})`);
    return jsonResponse(updated, { origin });
  } catch (err) {
    logger.error(`Error updating character: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
