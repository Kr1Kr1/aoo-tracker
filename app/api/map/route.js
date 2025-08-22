import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { logger } from "@/lib/logger";

// Validation schema for map data
const MapDataSchema = z.object({
  tiles: z.array(z.object({
    id: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    type: z.string().nullable(),
    imagePath: z.string()
  })),
  elements: z.array(z.object({
    x: z.number(),
    y: z.number(),
    type: z.string().nullable(),
    opacity: z.number(),
    imagePath: z.string()
  })),
  players: z.array(z.object({
    id: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    avatar: z.string()
  })),
  walls: z.array(z.object({
    id: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    type: z.string().nullable()
  })),
  gridCells: z.array(z.object({
    x: z.number(),
    y: z.number(),
    gridX: z.number().nullable(),
    gridY: z.number().nullable()
  })),
  background: z.string().nullable()
});

export async function POST(request) {
  try {
    const body = await request.json();
    logger.debug(`[API] Received map data: ${JSON.stringify(body)}`);
    
    const validatedData = MapDataSchema.parse(body);
    logger.info(`[API] Map data validation successful`);

    // Create or update map
    const map = await prisma.maps.upsert({
      where: { name: 'current_map' },
      create: { name: 'current_map' },
      update: {}
    });
    logger.info(`[API] Map record upserted with ID: ${map.id}`);

    // Process tiles
    logger.info(`[API] Processing ${validatedData.tiles.length} tiles`);
    for (const tile of validatedData.tiles) {
      const coords = await prisma.coords.create({
        data: {
          x: tile.x,
          y: tile.y,
          z: 0,
          mapId: map.id
        }
      });

      await prisma.mapTiles.create({
        data: {
          name: tile.type || 'unknown',
          coordsId: coords.id,
          foreground: 0
        }
      });
    }

    // Process elements
    logger.info(`[API] Processing ${validatedData.elements.length} elements`);
    for (const element of validatedData.elements) {
      const coords = await prisma.coords.create({
        data: {
          x: element.x,
          y: element.y,
          z: 0,
          mapId: map.id
        }
      });

      await prisma.mapElements.create({
        data: {
          name: element.type || 'unknown',
          coordsId: coords.id,
          endTime: 0
        }
      });
    }

    logger.info(`[API] Map data processing completed successfully`);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(`[API] Error processing map data: ${error.message}`, { stack: error.stack });
    return NextResponse.json(
      { error: 'Failed to process map data' },
      { status: 500 }
    );
  }
}
