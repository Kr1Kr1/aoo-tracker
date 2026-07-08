import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight, parseTargetId } from "@/lib/api";

export async function GET(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const eventId = parseTargetId(id);
    if (eventId === null) return errorResponse("Invalid event id", 400, origin);

    const event = await prisma.events.findUnique({ where: { id: eventId } });
    if (!event) return errorResponse("Event not found", 404, origin);
    return jsonResponse(event, { origin });
  } catch (err) {
    logger.error(`Error fetching event: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function PUT(request, context) {
  const origin = request.headers.get("origin");
  try {
    const { id } = await context.params;
    const eventId = parseTargetId(id);
    if (eventId === null) return errorResponse("Invalid event id", 400, origin);

    const { event, details, fromCol, withWhom, date, territory, source } = await request.json();

    const updated = await prisma.events.update({
      where: { id: eventId },
      data: { event, details, fromCol, withWhom, date, territory, source },
    });
    logger.info(`Updated event ${eventId}`);
    return jsonResponse(updated, { origin });
  } catch (err) {
    logger.error(`Error updating event: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
