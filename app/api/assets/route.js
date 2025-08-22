import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { logger } from "@/lib/logger";

// Map of asset types to their directories
const ASSET_DIRS = {
  tiles: 'tiles',
  elements: 'elements',
  avatars: 'avatars',
  walls: 'walls'
};

export async function POST(request) {
  try {
    const { url, type } = await request.json();
    logger.debug(`[API] Received asset download request for type: ${type}, url: ${url}`);
    
    if (!url || !type || !ASSET_DIRS[type]) {
      logger.warn(`[API] Invalid request. URL: ${url}, type: ${type}`);
      return NextResponse.json(
        { error: 'Invalid request. URL and valid type required.' },
        { status: 400 }
      );
    }

    // Extract filename from URL
    const filename = url.split('/').pop();
    if (!filename) {
      logger.warn(`[API] Could not extract filename from URL: ${url}`);
      return NextResponse.json(
        { error: 'Could not extract filename from URL' },
        { status: 400 }
      );
    }

    // Create asset directory if it doesn't exist
    const assetDir = path.join(process.cwd(), 'public', 'assets', ASSET_DIRS[type]);
    await mkdir(assetDir, { recursive: true });
    logger.info(`[API] Ensuring asset directory exists: ${assetDir}`);

    // Full path for the new file
    const filePath = path.join(assetDir, filename);
    
    // Download and save the image
    const response = await fetch(url);
    if (!response.ok) {
      logger.error(`[API] Failed to fetch image from URL: ${url}, status: ${response.status}`);
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));
    logger.info(`[API] Successfully saved asset to: ${filePath}`);

    // Return the local path that can be used to access the image
    const publicPath = `/assets/${ASSET_DIRS[type]}/${filename}`;
    
    logger.debug(`[API] Returning public path: ${publicPath}`);
    return NextResponse.json({
      success: true,
      path: publicPath
    });
  } catch (error) {
    logger.error(`[API] Error processing asset: ${error.message}`, { stack: error.stack });
    return NextResponse.json(
      { error: 'Failed to process asset' },
      { status: 500 }
    );
  }
}
