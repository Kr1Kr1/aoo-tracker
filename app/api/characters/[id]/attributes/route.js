import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight, parseTargetId } from "@/lib/api";
import { getCallerContext, canAccessTargetId } from "@/lib/authContext";

const ALLOWED_ATTRIBUTES = [
  "cc", "ct", "f", "e", "agi", "pv",
  "pm", "fm", "m", "a", "mvt", "p",
  "r", "rm", "xp", "spd",
];

const DEFAULT_ATTRIBUTES = {
  cc: 0, ct: 0, f: 0, e: 0, agi: 0, pv: 0,
  pm: 0, fm: 0, m: 0, a: 0, mvt: 0, p: 0,
  r: 0, rm: 0, xp: 0,
};

function pickAttributes(body) {
  const filtered = {};
  for (const key of ALLOWED_ATTRIBUTES) {
    if (body[key] !== undefined) filtered[key] = body[key];
  }
  return filtered;
}

async function authorize(request, targetId, origin) {
  const ctx = await getCallerContext(request);
  if (!ctx) return errorResponse("Unauthorized", 401, origin);
  if (!canAccessTargetId(ctx, targetId)) return errorResponse("Forbidden", 403, origin);
  return null;
}

export async function POST(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const targetId = parseTargetId(id);
    if (targetId === null) return errorResponse("Invalid targetId", 400, origin);

    const denied = await authorize(request, targetId, origin);
    if (denied) return denied;

    const rawBody = await request.json();
    const body = pickAttributes(rawBody);

    const character = await prisma.characters.findUnique({
      where: { targetId },
      include: { attributes: true },
    });
    if (!character) return errorResponse("Character not found", 404, origin);

    const currentAttributes = character.attributes || DEFAULT_ATTRIBUTES;
    const updatedAttributes = { ...currentAttributes, ...body, characterId: character.id };

    const changeLogs = [];
    for (const [attr, newValue] of Object.entries(body)) {
      const oldValue = currentAttributes[attr];
      if (oldValue !== newValue) {
        changeLogs.push({
          characterId: character.id,
          attribute: attr,
          oldValue: oldValue?.toString() ?? null,
          newValue: newValue?.toString() ?? null,
        });
      }
    }
    if (changeLogs.length > 0) {
      await prisma.characterLog.createMany({ data: changeLogs });
    }

    const attributes = await prisma.characterAttributes.upsert({
      where: { characterId: character.id },
      update: updatedAttributes,
      create: updatedAttributes,
    });

    logger.info(`Updated attributes for ${character.name} (${targetId})`);
    return jsonResponse(attributes, { origin });
  } catch (err) {
    logger.error(`Error updating attributes: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function GET(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const targetId = parseTargetId(id);
    if (targetId === null) return errorResponse("Invalid targetId", 400, origin);

    const denied = await authorize(request, targetId, origin);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const includeLogs = searchParams.get("logs") === "true";

    const character = await prisma.characters.findUnique({
      where: { targetId },
      include: { attributes: true },
    });
    if (!character) return errorResponse("Character not found", 404, origin);

    const response = { attributes: character.attributes };
    if (includeLogs) {
      response.logs = await prisma.characterLog.findMany({
        where: { characterId: character.id },
        orderBy: { changedAt: "desc" },
      });
    }
    return jsonResponse(response, { origin });
  } catch (err) {
    logger.error(`Error fetching attributes: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
