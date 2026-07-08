import { getCallerContext } from "@/lib/authContext";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";

// Links the authenticated user to a Character (the implicit
// _CharactersToUser join table). Idempotent. Used by the extension to
// auto-link the AOM-logged-in character to the tracker user, so the
// dashboard knows "who am I" without manual setup.
//
// Authorization:
//   - admins can link any targetId
//   - regular users can only link a character that has 0 existing user links
//     (prevents stealing someone else's character)
export async function POST(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const { targetId, name } = await request.json();
    if (typeof targetId !== "number" || !Number.isFinite(targetId)) {
      return errorResponse("targetId must be a number", 400, origin);
    }

    let character = await prisma.characters.findUnique({
      where: { targetId },
      select: { id: true, users: { select: { id: true } } },
    });
    // Not imported yet (typically a PNJ the user is incarnating). Create a
    // minimal row from the name the extension read off the page so the persona
    // can be linked and its map vision segregated. A later "Fetch All
    // Characters" PATCHes in the full data.
    if (!character) {
      if (typeof name !== "string" || !name.trim()) {
        return errorResponse("Character not found", 404, origin);
      }
      character = await prisma.characters.create({
        data: { targetId, name: name.trim() },
        select: { id: true, users: { select: { id: true } } },
      });
      logger.info(`Auto-created persona targetId=${targetId} name="${name.trim()}"`);
    }

    const alreadyLinked = character.users.some((u) => u.id === ctx.userId);
    if (alreadyLinked) {
      return jsonResponse({ ok: true, alreadyLinked: true }, { origin });
    }

    if (ctx.role !== "admin" && character.users.length > 0) {
      return errorResponse(
        "Character already linked to another user",
        403,
        origin
      );
    }

    await prisma.user.update({
      where: { id: ctx.userId },
      data: { characters: { connect: { id: character.id } } },
    });
    logger.info(`User ${ctx.username} linked to character targetId=${targetId}`);
    return jsonResponse({ ok: true, alreadyLinked: false }, { origin });
  } catch (err) {
    logger.error(`Error linking character: ${err.message}`, { stack: err.stack });
    return errorResponse("Failed to link character", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
