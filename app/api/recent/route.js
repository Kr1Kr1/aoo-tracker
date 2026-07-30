import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext, visibleTargetIds, visibleCharacterIds } from "@/lib/authContext";

// Allowlist of models exposed to the client. Each entry knows how to
// scope queries to the caller's accessible characters.
const ALLOWED_MODELS = {
  // Data commune : les nouvelles fiches PJ/PNJ intéressent tout le monde, on ne
  // les filtre pas sur les personnages du compte ni sur l'acting-as.
  characters: { include: { faction: true }, scope: () => ({}), needsCharacterIds: false },
  events: {
    include: { character: { include: { faction: true } } },
    scope: (characterIds) => (characterIds === null ? {} : { characterId: { in: characterIds } }),
    needsCharacterIds: true,
  },
  forums: { include: { faction: true }, scope: () => ({}), needsCharacterIds: false },
  topics: { include: {}, scope: () => ({}), needsCharacterIds: false },
  messages: {
    include: { character: true },
    scope: (characterIds) => (characterIds === null ? {} : { characterId: { in: characterIds } }),
    needsCharacterIds: true,
  },
  equipment: {
    include: {},
    scope: (characterIds) => (characterIds === null ? {} : { characterId: { in: characterIds } }),
    needsCharacterIds: true,
  },
};

export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model");
    const days = parseInt(searchParams.get("days") || "7", 10);

    if (!model || !(model in ALLOWED_MODELS)) {
      return errorResponse(
        `Invalid model. Allowed: ${Object.keys(ALLOWED_MODELS).join(", ")}`,
        400,
        origin
      );
    }

    const config = ALLOWED_MODELS[model];
    const scopeKeys = config.needsCharacterIds
      ? await visibleCharacterIds(ctx)
      : visibleTargetIds(ctx);
    const scopeWhere = config.scope(scopeKeys);

    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);

    const records = await prisma[model].findMany({
      where: {
        ...scopeWhere,
        createdAt: { gte: dateThreshold },
      },
      ...(Object.keys(config.include || {}).length ? { include: config.include } : {}),
      orderBy: { createdAt: "desc" },
    });

    logger.info(`Recent ${model}: ${records.length} records over ${days}d for ${ctx.username}`);
    return jsonResponse(records, { origin });
  } catch (err) {
    logger.error(`Error fetching recent records: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
