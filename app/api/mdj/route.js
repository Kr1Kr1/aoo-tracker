import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext, visibleCharacterIds } from "@/lib/authContext";

export async function GET(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
    const sinceParam = url.searchParams.get("since");

    const allowed = await visibleCharacterIds(ctx);
    const where = allowed === null ? {} : { characterId: { in: allowed } };
    if (sinceParam) {
      const since = new Date(sinceParam);
      if (!Number.isNaN(since.getTime())) {
        where.createdAt = { gte: since };
      }
    }

    const [entries, total] = await Promise.all([
      prisma.mDJHistory.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          character: {
            select: {
              id: true,
              targetId: true,
              name: true,
              rank: true,
              race: true,
              faction: { select: { name: true } },
            },
          },
        },
      }),
      prisma.mDJHistory.count({ where }),
    ]);

    return jsonResponse({ entries, total, offset, limit }, { origin });
  } catch (err) {
    logger.error(`Error fetching MDJ history: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
