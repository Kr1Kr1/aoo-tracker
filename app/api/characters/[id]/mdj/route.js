import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const prisma = new PrismaClient();

export async function POST(req, context) {
    try {
      // Await params destructuring
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
      const { mdj } = body;
  
      if (!mdj || !mdj.trim()) {
        logger.warn("[API] Missing or empty MDJ content");
        return new Response(JSON.stringify({ error: "Missing or empty MDJ content" }), {
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
          status: 400,
          headers: corsHeaders(),
        });
      }
  
      // Fetch the most recent MDJ for the character
      const mostRecentMdj = await prisma.mDJHistory.findFirst({
        where: { characterId: character.id },
        orderBy: { createdAt: "desc" }, // Fetch the most recent entry
      });
  
      // Compare with the new MDJ content
      if (mostRecentMdj && mostRecentMdj.mdj.trim() === mdj.trim()) {
        logger.info(`[API] Duplicate MDJ content detected for character with targetId ${parsedTargetId}`);
        return new Response(JSON.stringify({ error: "Duplicate MDJ content detected" }), {
          status: 409, // Conflict
          headers: corsHeaders(),
        });
      }
  
      // Create a new MDJHistory entry
      const mdjEntry = await prisma.mDJHistory.create({
        data: {
          characterId: character.id, // Use the `id` from the retrieved character
          mdj: mdj.trim(),
        },
      });
  
      logger.info(`[API] Created new MDJ entry for character with targetId ${parsedTargetId}: ${JSON.stringify(mdjEntry)}`);
      return new Response(JSON.stringify(mdjEntry), {
        headers: corsHeaders(),
      });
    } catch (error) {
      logger.error(`[API] Error updating MDJ for character: ${error.message}`, { stack: error.stack });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
}

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
  
      // Fetch the MDJ history for the character
      const mdjHistory = await prisma.mDJHistory.findMany({
        where: { characterId: character.id },
        orderBy: { createdAt: "desc" },
      });

      return new Response(JSON.stringify(mdjHistory), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error in GET /api/characters/[id]/mdj:", error);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
      });
    }
}  
  
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
