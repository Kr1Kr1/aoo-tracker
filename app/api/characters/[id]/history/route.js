import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const prisma = new PrismaClient();

// POST: Add a new history entry for a character
export async function POST(req, context) {
    try {
      const params = await context.params;
      const { id: targetId } = params;
  
      if (!targetId) {
        logger.error("[API] Missing targetId in request parameters");
        return new Response(JSON.stringify({ error: "Character targetId is required" }), {
          status: 400,
          headers: corsHeaders(),
        });
      }
  
      const parsedTargetId = parseInt(targetId, 10);
      if (isNaN(parsedTargetId)) {
        logger.error("[API] Invalid targetId provided");
        return new Response(JSON.stringify({ error: "Invalid character targetId" }), {
          status: 400,
          headers: corsHeaders(),
        });
      }
  
      const body = await req.json();
      let { story } = body;
  
      // Allow empty or missing story
      story = story ? story.trim() : ""; // Set to empty string if not provided
  
      // Validate character existence by `targetId`
      const character = await prisma.characters.findUnique({
        where: { targetId: parsedTargetId },
      });
  
      if (!character) {
        logger.error(`[API] Character with targetId ${parsedTargetId} does not exist`);
        return new Response(JSON.stringify({ error: "Invalid character targetId" }), {
          status: 400,
          headers: corsHeaders(),
        });
      }
  
      // Fetch the most recent story for the character
      const mostRecentStory = await prisma.characterHistory.findFirst({
        where: { characterId: character.id },
        orderBy: { modifiedAt: "desc" },
      });
  
      if (mostRecentStory && mostRecentStory.story.trim() === story) {
        logger.info(`[API] Duplicate story content detected for character with targetId ${parsedTargetId}`);
        return new Response(
          JSON.stringify({
            message: "Content is identical to the most recent story. No update performed.",
          }),
          {
            status: 200, // Success
            headers: corsHeaders(),
          }
        );
      }
  
      // Create a new CharacterHistory entry
      const historyEntry = await prisma.characterHistory.create({
        data: {
          characterId: character.id,
          story, // Allow empty string as valid content
        },
      });
  
      logger.info(`[API] Created new story entry for character with targetId ${parsedTargetId}: ${JSON.stringify(historyEntry)}`);
      return new Response(JSON.stringify(historyEntry), {
        headers: corsHeaders(),
      });
    } catch (error) {
      logger.error(`[API] Error updating story for character: ${error.message}`, { stack: error.stack });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
}

// GET: Fetch the history for a character
export async function GET(req, context) {
  try {
    const params = await context.params;
    const { id: targetId } = params;

    if (!targetId) {
      return new Response(JSON.stringify({ error: "Missing targetId in the request" }), {
        status: 400,
      });
    }

    const parsedTargetId = parseInt(targetId, 10);

    if (isNaN(parsedTargetId)) {
      return new Response(JSON.stringify({ error: "Invalid targetId format" }), {
        status: 400,
      });
    }

    // Fetch the character by targetId
    const character = await prisma.characters.findUnique({
      where: { targetId: parsedTargetId },
    });

    if (!character) {
      return new Response(JSON.stringify({ error: "Character not found" }), {
        status: 404,
      });
    }

    // Fetch the character history
    const history = await prisma.characterHistory.findMany({
      where: { characterId: character.id },
      orderBy: { modifiedAt: "desc" },
    });

    logger.info(`[API] Retrieved ${history.length} history entries for character with id ${character.id}`);
    logger.info(`[API] Full history entries: ${JSON.stringify(history, null, 2)}`);

    return new Response(JSON.stringify(history), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in GET /api/characters/[id]/history:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
    });
  }
}

// OPTIONS: Handle CORS preflight
export async function OPTIONS(req) {
  return new Response(null, {
    headers: corsHeaders(),
    status: 204, // No content
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}
