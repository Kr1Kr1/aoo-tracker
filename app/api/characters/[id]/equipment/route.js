import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const prisma = new PrismaClient();

// POST: Add new equipment for a character
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
    
    // Handle both single item and array of items
    const equipmentItems = Array.isArray(body.equipment) ? body.equipment : [body];
    
    if (equipmentItems.length === 0) {
      logger.info("[API] No equipment items to process");
      return new Response(JSON.stringify({ message: "No equipment items to process" }), {
        status: 200,
        headers: corsHeaders(),
      });
    }

    // Validate character existence by `targetId`
    const character = await prisma.characters.findUnique({
      where: { targetId: parsedTargetId },
    });

    if (!character) {
      logger.error(`[API] Character with targetId ${parsedTargetId} does not exist`);
      return new Response(JSON.stringify({ error: "Invalid character targetId" }), {
        status: 404,
        headers: corsHeaders(),
      });
    }

    const results = [];
    const errors = [];

    // Process each equipment item
    for (const item of equipmentItems) {
      const { name, description, type, price, imageUrl, thumbnailUrl } = item;

      if (!name || !type) {
        errors.push({ item, error: "Name and type are required for equipment" });
        continue;
      }

      try {
        // Create a new equipment entry
        const equipmentEntry = await prisma.equipment.create({
          data: {
            name,
            description: description || "No description provided",
            type,
            price: price || null,
            imageUrl: imageUrl || null,
            thumbnailUrl: thumbnailUrl || null,
            characterId: character.id,
          },
        });
        results.push(equipmentEntry);
        logger.info(`[API] Created equipment '${name}' for character ${parsedTargetId}`);
      } catch (error) {
        errors.push({ item, error: error.message });
        logger.error(`[API] Failed to create equipment '${name}': ${error.message}`);
      }
    }

    // Return response with results and any errors
    return new Response(JSON.stringify({ results, errors }), {
      status: errors.length > 0 ? 207 : 200, // 207 Multi-Status if there are partial failures
      headers: corsHeaders(),
    });
  } catch (error) {
    logger.error(`[API] Error adding equipment for character: ${error.message}`, { stack: error.stack });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
}

// GET: Fetch all equipment for a character
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

    // Fetch the character's equipment
    const equipment = await prisma.equipment.findMany({
      where: { characterId: character.id },
      orderBy: { id: "asc" },
    });

    return new Response(JSON.stringify(equipment), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("Error in GET /api/characters/[id]/equipment:", error);
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
