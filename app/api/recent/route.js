import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const prisma = new PrismaClient();

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const model = searchParams.get("model"); // e.g., "Characters", "Events"
    const days = parseInt(searchParams.get("days") || "7", 10); // Default to 7 days

    if (!model) {
      logger.error("[API] Missing 'model' query parameter");
      return new Response(
        JSON.stringify({ error: "Missing 'model' query parameter" }),
        { status: 400 }
      );
    }

    if (!(model in prisma)) {
      logger.error(`[API] Invalid model: ${model}`);
      return new Response(JSON.stringify({ error: `Invalid model: ${model}` }), {
        status: 400,
      });
    }

    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);

    logger.info(
      `[API] Fetching recent records from '${model}' created in the last ${days} days`
    );

    const records = await prisma[model].findMany({
      where: {
        createdAt: {
          gte: dateThreshold,
        },
      },
      include: model === "Characters" ? {
        faction: true
      } : undefined,
      orderBy: {
        createdAt: "desc",
      },
    });

    logger.info(
      `[API] Retrieved ${records.length} records from '${model}' in the last ${days} days`
    );

    return new Response(JSON.stringify(records), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    logger.error(`[API] Error fetching recent records: ${error.message}`, {
      stack: error.stack,
    });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
    });
  }
}
