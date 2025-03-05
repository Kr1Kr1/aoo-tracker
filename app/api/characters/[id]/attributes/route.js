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
      const { cc, ct, f, e, agi, pv, pm, fm, m, a, mvt, p, spd, r, rm, xp } = body;
  
      if (
        cc === undefined || ct === undefined || f === undefined || e === undefined || 
        agi === undefined || pv === undefined || pm === undefined || fm === undefined || 
        m === undefined || a === undefined || mvt === undefined || p === undefined || 
        r === undefined || rm === undefined || xp === undefined
      ) {
        logger.warn("[API] Missing required attribute fields in request body", {
          missingFields: {
            cc: cc === undefined,
            ct: ct === undefined,
            f: f === undefined,
            e: e === undefined,
            agi: agi === undefined,
            pv: pv === undefined,
            pm: pm === undefined,
            fm: fm === undefined,
            m: m === undefined,
            a: a === undefined,
            mvt: mvt === undefined,
            p: p === undefined,
            r: r === undefined,
            rm: rm === undefined,
            xp: xp === undefined,
          },
        });
        return new Response(JSON.stringify({ error: "Missing required attribute fields in request body" }), {
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
  
      logger.debug(`[API] Fetched character: ${JSON.stringify(character)}`);
      logger.debug(`[API] Proceeding to upsert attributes for character ID: ${character.id}`);
  
      // Upsert attributes (update if exists, create if not)
      const attributes = await prisma.characterAttributes.upsert({
        where: { characterId: character.id },
        update: {
          cc, ct, f, e, agi, pv, pm, fm, m, a, mvt, p, spd, r, rm, xp,
        },
        create: {
          characterId: character.id,
          cc, ct, f, e, agi, pv, pm, fm, m, a, mvt, p, spd, r, rm, xp,
        },
      });
  
      logger.info(`[API] Updated attributes for character with targetId ${parsedTargetId}: ${JSON.stringify(attributes)}`);
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