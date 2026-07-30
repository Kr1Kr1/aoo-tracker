import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext, canAccessTargetId } from "@/lib/authContext";

// Le trombinoscope PJ/PNJ est de la data commune : tout le monde croise tout le
// monde en jeu, et infos.php est public. On ne le restreint donc ni aux
// personnages rattachés au compte ni au personnage joué en session
// (acting-as) : ce filtre ne vaut que pour ce qui est personnel (events,
// missives, mdj, équipement).
export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const characters = await prisma.characters.findMany({
      include: {
        faction: true,
        attributes: true,
        mdjHistory: { orderBy: { createdAt: "desc" }, take: 1 },
        storyHistory: { orderBy: { modifiedAt: "desc" }, take: 1 },
      },
      orderBy: { attributes: { xp: "desc" } },
    });

    const enriched = characters.map((character) => ({
      ...character,
      mostRecentMDJ:
        character.mdjHistory[0]?.mdj ||
        "Ce personnage est trop éloigné pour l'entendre parler.",
      mostRecentStory:
        character.storyHistory[0]?.story || "Je préfère garder cela pour moi.",
    }));

    return jsonResponse(enriched, { origin });
  } catch (err) {
    logger.error(`Error fetching characters: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const body = await request.json();
    const { targetId, name, rank, popularity, faction, role, race, portraitUrl, mdj, story } = body;
    if (!name || !targetId) {
      return errorResponse("Missing required fields: name or targetId", 400, origin);
    }
    if (!canAccessTargetId(ctx, targetId)) {
      return errorResponse("Forbidden: targetId not linked to this user", 403, origin);
    }

    const factionName = faction || "Unknown";
    const factionRecord = await prisma.factions.upsert({
      where: { name: factionName },
      create: { name: factionName },
      update: {},
    });

    // Map ingest (POST /api/maps) auto-creates placeholder rows ("PNJ -97" /
    // "Joueur 57") for players seen on the map before they're imported here.
    // Fill those in with the real data instead of rejecting as duplicates.
    const existingCharacter = await prisma.characters.findUnique({ where: { targetId } });
    const isPlaceholder =
      existingCharacter &&
      (existingCharacter.name === `PNJ ${targetId}` ||
        existingCharacter.name === `Joueur ${targetId}`);
    if (existingCharacter && !isPlaceholder) {
      return jsonResponse(
        { error: "Duplicate character", existingCharacter },
        { status: 409, origin }
      );
    }

    const characterData = {
      name,
      rank,
      popularity,
      role,
      race,
      portraitUrl,
      factionId: factionRecord.id,
    };
    const newCharacter = existingCharacter
      ? await prisma.characters.update({
          where: { targetId },
          data: characterData,
        })
      : await prisma.characters.create({
          data: { targetId, ...characterData },
        });

    if (mdj) {
      await prisma.mDJHistory.create({ data: { characterId: newCharacter.id, mdj } });
    }
    if (story) {
      await prisma.characterHistory.create({ data: { characterId: newCharacter.id, story } });
    }

    logger.info(
      `${existingCharacter ? "Filled placeholder" : "Created"} character: ${newCharacter.name} (${targetId})`
    );
    return jsonResponse(newCharacter, { origin });
  } catch (err) {
    logger.error(`Error creating character: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
