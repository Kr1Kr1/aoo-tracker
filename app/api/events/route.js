import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { parseDate } from "@/lib/dateUtils";
import { getCallerContext, visibleCharacterIds, canAccessTargetId } from "@/lib/authContext";

export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    const allowed = await visibleCharacterIds(ctx);
    const where = allowed === null ? {} : { characterId: { in: allowed } };

    const [events, totalEvents] = await Promise.all([
      prisma.events.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { calculatedDate: "desc" },
        include: { character: { include: { faction: true } } },
      }),
      prisma.events.count({ where }),
    ]);

    const fromIds = Array.from(
      new Set(
        events
          .map((e) => e.fromCol.match(/\(mat\.(\d+)\)/)?.[1])
          .filter(Boolean)
          .map((id) => parseInt(id, 10))
      )
    );
    const fromCharacters = fromIds.length
      ? await prisma.characters.findMany({
          where: { targetId: { in: fromIds } },
          include: { faction: true },
        })
      : [];
    const fromByTargetId = new Map(fromCharacters.map((c) => [c.targetId, c]));

    const enriched = events.map((event) => {
      const match = event.fromCol.match(/\(mat\.(\d+)\)/);
      const targetId = match ? parseInt(match[1], 10) : null;
      const fromCharacter = targetId != null ? fromByTargetId.get(targetId) : null;
      return { ...event, fromCharacterFaction: fromCharacter?.faction || null };
    });

    return jsonResponse(
      { events: enriched, total: totalEvents, offset, limit },
      { origin }
    );
  } catch (err) {
    logger.error(`Error fetching events: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const body = await request.json();
    const {
      event,
      details,
      fromCol,
      withWhom,
      date,
      territory,
      source = "Manual",
      playerId,
    } = body;

    if (!event || !fromCol || !date || !territory || !playerId) {
      return errorResponse("Missing required fields", 400, origin);
    }
    if (!canAccessTargetId(ctx, playerId)) {
      return errorResponse("Forbidden: playerId not linked to this user", 403, origin);
    }

    const calculatedDate = parseDate(date);
    if (!calculatedDate) {
      return errorResponse("Invalid date format", 400, origin);
    }

    const character = await prisma.characters.findUnique({
      where: { targetId: playerId },
    });
    if (!character) {
      return errorResponse(`Character not found for playerId ${playerId}`, 404, origin);
    }

    const existingEvent = await prisma.events.findFirst({
      where: {
        event,
        territory,
        calculatedDate,
        fromCol,
        source,
        characterId: character.id,
      },
    });
    if (existingEvent) {
      return jsonResponse(
        { code: "duplicate", existingEvent },
        { status: 409, origin }
      );
    }

    const newEvent = await prisma.events.create({
      data: {
        event,
        details,
        fromCol,
        withWhom,
        date,
        calculatedDate,
        territory,
        source,
        characterId: character.id,
      },
    });
    return jsonResponse(newEvent, { origin });
  } catch (err) {
    logger.error(`Error creating event: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
