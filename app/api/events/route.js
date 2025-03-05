import { PrismaClient } from "@prisma/client";
import { parseDate } from "@/lib/dateUtils";

const prisma = new PrismaClient();

export async function GET(req) {
  try {
    // Extract query parameters for offset and limit
    const url = new URL(req.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    console.log(`[API] Fetching events with offset=${offset}, limit=${limit}`);

    // Fetch events with pagination, including character and faction details
    const events = await prisma.events.findMany({
      skip: offset,
      take: limit,
      orderBy: {
        calculatedDate: "desc", // Ensure consistent ordering
      },
      include: {
        character: {
          include: {
            faction: true, // Include faction details
          },
        },
      },
    });

    // Enhance events by including faction info of the character in `fromCol`
    const enrichedEvents = await Promise.all(
      events.map(async (event) => {
        // Extract targetId from `fromCol` using regex
        const match = event.fromCol.match(/\(mat\.(\d+)\)/);
        if (!match) return { ...event, fromCharacterFaction: null }; // If no match, return as is

        const targetId = parseInt(match[1], 10);

        // Fetch the character from `Characters` table using targetId
        const fromCharacter = await prisma.characters.findUnique({
          where: { targetId },
          include: {
            faction: true, // Include faction details
          },
        });

        return {
          ...event,
          fromCharacterFaction: fromCharacter?.faction || null,
        };
      })
    );

    // Count total events for pagination metadata
    const totalEvents = await prisma.events.count();

    // Return the events and metadata
    return new Response(
      JSON.stringify({
        events: enrichedEvents,
        total: totalEvents,
        offset,
        limit,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("[API] Error fetching events:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    console.log("[API] Parsed request body:", body);

    const { event, details, fromCol, withWhom, date, territory, source = "Manual", playerId } = body;

    if (!event || !fromCol || !date || !territory || !playerId) {
      console.error("[API] Missing required fields in the request:", {
        event,
        fromCol,
        date,
        territory,
        playerId,
      });
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const calculatedDate = parseDate(date);
    console.log("[API] Parsed calculatedDate:", calculatedDate);

    if (!calculatedDate) {
      console.error("[API] Failed to parse date:", date);
      return new Response(JSON.stringify({ error: "Invalid date format" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Fetch the character ID using playerId
    console.log("[API] Looking up character with playerId:", playerId);
    const character = await prisma.characters.findUnique({
      where: { targetId : playerId },
    });
    console.log("[API] Query result for character:", character);

    if (!character) {
      console.error("[API] Character not found for playerId:", playerId);
      return new Response(JSON.stringify({ error: "Character not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const characterId = character.id;

    console.log("[API] Resolved characterId:", characterId);

    // Check for duplicates
    const existingEvent = await prisma.events.findFirst({
      where: {
        event,
        territory,
        calculatedDate,
        fromCol,
        source,
        characterId,
      },
    });

    if (existingEvent) {
      console.log("[API] Duplicate event detected:", existingEvent);
      return new Response(JSON.stringify({ error: "Duplicate event", existingEvent }), {
        status: 409,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Create new event
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
        characterId,
      },
    });

    return new Response(JSON.stringify(newEvent), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("[API] Error processing the request:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}


// Handle OPTIONS preflight requests
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
