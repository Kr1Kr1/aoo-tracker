import { writeFile, mkdir, readdir, rm } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext } from "@/lib/authContext";
import { requireIngestSecret } from "@/lib/ingestAuth";

const MAX_BYTES = 5 * 1024 * 1024;
const RETENTION_DAYS = 30;
const ASSETS_ROOT = path.join(process.cwd(), "public", "assets", "snapshots");

const MetadataSchema = z.object({
  capturedAt: z.string().datetime(),
  svgWidth: z.number().int().positive(),
  svgHeight: z.number().int().positive(),
  playerId: z.number().int().optional().nullable(),
  layers: z
    .array(
      z.object({
        key: z.string().min(1).max(32),
        sourceHref: z.string().min(1),
        x: z.number().int(),
        y: z.number().int(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        zOrder: z.number().int().min(0),
      })
    )
    .min(1)
    .max(16),
});

function safeIso(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function pickExtension(sourceHref: string): "webp" | "png" {
  return sourceHref.toLowerCase().endsWith(".webp") ? "webp" : "png";
}

async function pruneFilesOlderThan(cutoff: Date) {
  let entries: string[] = [];
  try {
    entries = await readdir(ASSETS_ROOT);
  } catch {
    return;
  }
  for (const entry of entries) {
    // Recover the ISO timestamp from the safe form:
    //   2026-05-19T10-00-00Z         (no ms)
    //   2026-05-19T10-00-00-123Z     (with ms)
    const m = entry.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/);
    if (!m) continue;
    const ms = m[5] ? `.${m[5]}` : "";
    const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}${ms}Z`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) continue;
    if (date < cutoff) {
      const target = path.join(ASSETS_ROOT, entry);
      const resolved = path.resolve(target);
      if (!resolved.startsWith(path.resolve(ASSETS_ROOT) + path.sep)) continue;
      await rm(resolved, { recursive: true, force: true });
    }
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  try {
    const denial = requireIngestSecret(request, origin);
    if (denial) return denial;

    const form = await request.formData();
    const metaRaw = form.get("metadata");
    if (typeof metaRaw !== "string") {
      return errorResponse("Missing metadata", 400, origin);
    }

    let metaJson: unknown;
    try {
      metaJson = JSON.parse(metaRaw);
    } catch {
      return errorResponse("Invalid metadata JSON", 400, origin);
    }

    const parsed = MetadataSchema.safeParse(metaJson);
    if (!parsed.success) {
      return errorResponse(`Bad metadata: ${parsed.error.message}`, 400, origin);
    }
    const meta = parsed.data;

    const capturedAt = new Date(meta.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      return errorResponse("Invalid capturedAt", 400, origin);
    }

    const existing = await prisma.mapSnapshot.findUnique({
      where: { capturedAt },
      select: { id: true },
    });
    if (existing) {
      return jsonResponse({ id: existing.id, deduped: true }, { origin });
    }

    const safeDir = safeIso(meta.capturedAt);
    const snapshotDir = path.join(ASSETS_ROOT, safeDir);
    await mkdir(snapshotDir, { recursive: true });

    const layerRows: {
      layerKey: string;
      sourceHref: string;
      contentHash: string;
      filePath: string;
      x: number;
      y: number;
      width: number;
      height: number;
      zOrder: number;
    }[] = [];

    for (const layer of meta.layers) {
      const file = form.get(layer.key);
      if (!(file instanceof File)) {
        return errorResponse(`Missing file for layer "${layer.key}"`, 400, origin);
      }
      if (file.size > MAX_BYTES) {
        return errorResponse(`File too large for layer "${layer.key}"`, 400, origin);
      }
      // Uint8Array rather than Buffer: @types/node 20 types Buffer over
      // ArrayBufferLike, which no longer satisfies the ArrayBuffer-based
      // signatures of createHash().update() and writeFile().
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        return errorResponse(`File too large for layer "${layer.key}"`, 400, origin);
      }
      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      const ext = pickExtension(layer.sourceHref);
      const fileName = `${layer.key}.${ext}`;
      const onDiskPath = path.join(snapshotDir, fileName);
      await writeFile(onDiskPath, buf);
      layerRows.push({
        layerKey: layer.key,
        sourceHref: layer.sourceHref,
        contentHash: hash,
        filePath: `/assets/snapshots/${safeDir}/${fileName}`,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        zOrder: layer.zOrder,
      });
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);

    const [snapshot] = await prisma.$transaction([
      prisma.mapSnapshot.create({
        data: {
          capturedAt,
          svgWidth: meta.svgWidth,
          svgHeight: meta.svgHeight,
          playerId: meta.playerId ?? null,
          layers: { create: layerRows },
        },
        select: { id: true },
      }),
      prisma.mapSnapshot.deleteMany({
        where: { capturedAt: { lt: cutoff } },
      }),
    ]);

    await pruneFilesOlderThan(cutoff);

    logger.info(
      `Snapshot ingested id=${snapshot.id} at=${meta.capturedAt} layers=${layerRows.length}`
    );
    return jsonResponse({ id: snapshot.id, deduped: false }, { origin });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error(`Snapshot ingest failed: ${msg}`, { stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const url = new URL(request.url);
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const limitRaw = url.searchParams.get("limit");

    const where: { capturedAt?: { gte?: Date; lte?: Date } } = {};
    if (fromRaw) {
      const d = new Date(fromRaw);
      if (!Number.isNaN(d.getTime())) where.capturedAt = { ...where.capturedAt, gte: d };
    }
    if (toRaw) {
      const d = new Date(toRaw);
      if (!Number.isNaN(d.getTime())) where.capturedAt = { ...where.capturedAt, lte: d };
    }

    let limit = 200;
    if (limitRaw) {
      const parsed = parseInt(limitRaw, 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 1000);
    }

    const snapshots = await prisma.mapSnapshot.findMany({
      where,
      orderBy: { capturedAt: "asc" },
      take: limit,
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

    return jsonResponse(
      snapshots.map((s) => ({
        id: s.id,
        capturedAt: s.capturedAt.toISOString(),
        svgWidth: s.svgWidth,
        svgHeight: s.svgHeight,
        playerId: s.playerId,
        layers: s.layers,
      })),
      { origin }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Snapshot list failed: ${msg}`);
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get("origin"));
}
