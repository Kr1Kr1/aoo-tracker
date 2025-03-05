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
    const { name, description, type, price, imageUrl, thumbnailUrl } = body;

    if (!name || !type) {
      logger.error("[API] Missing required fields in request body");
      return new Response(JSON.stringify({ error: "Name and type are required for equipment" }), {
        status: 400,
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

    logger.info(`[API] Created new equipment for character with targetId ${parsedTargetId}: ${JSON.stringify(equipmentEntry)}`);
    return new Response(JSON.stringify(equipmentEntry), {
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
