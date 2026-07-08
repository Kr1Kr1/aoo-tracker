import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight, parseTargetId } from "@/lib/api";
import { getCallerContext } from "@/lib/authContext";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const { id: idRaw } = await params;
    const id = parseTargetId(idRaw);
    if (id === null) return errorResponse("Invalid id", 400, origin);

    const snapshot = await prisma.mapSnapshot.findUnique({
      where: { id },
      include: {
        layers: {
          orderBy: { zOrder: "asc" },
          select: {
            layerKey: true,
            sourceHref: true,
            filePath: true,
            x: true,
            y: true,
            width: true,
            height: true,
            zOrder: true,
          },
        },
      },
    });

    if (!snapshot) return errorResponse("Not found", 404, origin);

    return jsonResponse(
      {
        id: snapshot.id,
        capturedAt: snapshot.capturedAt.toISOString(),
        svgWidth: snapshot.svgWidth,
        svgHeight: snapshot.svgHeight,
        playerId: snapshot.playerId,
        layers: snapshot.layers,
      },
      { origin }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Snapshot fetch failed: ${msg}`);
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get("origin"));
}
