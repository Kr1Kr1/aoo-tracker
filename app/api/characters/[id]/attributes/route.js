import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const prisma = new PrismaClient();

// POST: Add or update attributes for a character
export async function POST(req, context) {
    try {
      logger.debug("[API] Received request to update attributes.");
      
      const params = await context.params;
      const { id: targetId } = params;
      logger.debug(`[API] Extracted targetId: ${targetId}`);
      
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
      logger.debug(`[API] Request body received: ${JSON.stringify(body)}`);
  
      // Validate character existence by `targetId`
      const character = await prisma.characters.findUnique({
        where: { targetId: parsedTargetId },
        include: { attributes: true }
      });
  
      if (!character) {
        logger.error(`[API] Character with targetId ${parsedTargetId} does not exist`);
        return new Response(JSON.stringify({ error: "Invalid character targetId" }), {
          status: 404,
          headers: corsHeaders(),
        });
      }
  
      logger.debug(`[API] Fetched character: ${JSON.stringify(character)}`);

      // Get current attributes
      const currentAttributes = character.attributes || {
        cc: 0, ct: 0, f: 0, e: 0, agi: 0, pv: 0, 
        pm: 0, fm: 0, m: 0, a: 0, mvt: 0, p: 0, 
        r: 0, rm: 0, xp: 0
      };

      // Create updated attributes
      const updatedAttributes = {
        ...currentAttributes,
        ...body,
        characterId: character.id
      };

      // Log changes to CharacterLog
      for (const [attr, newValue] of Object.entries(body)) {
        const oldValue = currentAttributes[attr];
        if (oldValue !== newValue) {
          await prisma.characterLog.create({
            data: {
              characterId: character.id,
              attribute: attr,
              oldValue: oldValue?.toString(),
              newValue: newValue?.toString()
            }
          });
          
          logger.info(`[API] Logged ${attr} change for character ${character.name} (${targetId}): ${oldValue} -> ${newValue}`);
        }
      }
  
      // Upsert attributes
      const attributes = await prisma.characterAttributes.upsert({
        where: { characterId: character.id },
        update: updatedAttributes,
        create: updatedAttributes,
      });
  
      logger.debug(`[API] Updated attributes for character with targetId ${parsedTargetId}: ${JSON.stringify(attributes)}`);
      return new Response(JSON.stringify(attributes), {
        headers: corsHeaders(),
      });
    } catch (error) {
      logger.error(`[API] Error adding or updating attributes: ${error.message}`);
      logger.debug(`[API] Full error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
}

// GET: Fetch attributes and logs for a character
export async function GET(req, context) {
  try {
    const params = await context.params;
    const { id: targetId } = params;
    const { searchParams } = new URL(req.url);
    const includeLogs = searchParams.get('logs') === 'true';
    
    if (!targetId) {
      return new Response(JSON.stringify({ error: "Character targetId is required" }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    const parsedTargetId = parseInt(targetId, 10);
    if (isNaN(parsedTargetId)) {
      return new Response(JSON.stringify({ error: "Invalid character targetId" }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    // Fetch character with attributes
    const character = await prisma.characters.findUnique({
      where: { targetId: parsedTargetId },
      include: { attributes: true }
    });

    if (!character) {
      return new Response(JSON.stringify({ error: "Character not found" }), {
        status: 404,
        headers: corsHeaders(),
      });
    }

    let response = { attributes: character.attributes };

    // Include logs if requested
    if (includeLogs) {
      const logs = await prisma.characterLog.findMany({
        where: { characterId: character.id },
        orderBy: { changedAt: 'desc' }
      });
      response.logs = logs;
    }

    return new Response(JSON.stringify(response), {
      headers: corsHeaders(),
    });
  } catch (error) {
    logger.error(`[API] Error fetching attributes: ${error.message}`);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: corsHeaders(),
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