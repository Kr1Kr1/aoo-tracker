import { writeFile, mkdir, access } from "fs/promises";
import path from "path";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext } from "@/lib/authContext";

// Strict allowlist: only assets from the AOM CDN, only image extensions,
// only paths under img/. Prevents SSRF + arbitrary write.
const ALLOWED_RE = /^https:\/\/age-of-olympia\.net\/(img\/[a-zA-Z0-9._/-]+\.(?:png|jpg|jpeg|webp|gif|svg))$/i;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap per file

const ASSETS_ROOT = path.join(process.cwd(), "public", "assets", "aom");

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadOne(url) {
  const match = url.match(ALLOWED_RE);
  if (!match) return { url, error: "URL not allowed" };

  const relPath = match[1]; // "img/tiles/falaise.png"
  const localPath = path.join(ASSETS_ROOT, relPath);

  if (await fileExists(localPath)) {
    return { url, path: `/assets/aom/${relPath}`, cached: true };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return { url, error: `HTTP ${res.status}` };

    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_BYTES) return { url, error: "File too large" };

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { url, error: "File too large" };

    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, buf);

    return { url, path: `/assets/aom/${relPath}`, cached: false };
  } catch (err) {
    return { url, error: err.message };
  }
}

// POST { urls: string[] } — downloads any not-yet-cached. Returns map of
// url → { path, cached } or { error }.
export async function POST(request) {
  const origin = request.headers.get("origin");
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return errorResponse("Unauthorized", 401, origin);

    const body = await request.json();
    const urls = Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [];
    if (urls.length === 0) {
      return errorResponse("No URLs provided", 400, origin);
    }
    if (urls.length > 500) {
      return errorResponse("Too many URLs (max 500 per request)", 400, origin);
    }

    // Sequential to avoid hammering the AOM CDN. Could chunk in parallel later.
    const results = [];
    for (const url of urls) {
      results.push(await downloadOne(url));
    }
    const okCount = results.filter((r) => r.path).length;
    logger.info(`Assets: ${okCount}/${urls.length} resolved (${ctx.username})`);
    return jsonResponse({ results }, { origin });
  } catch (err) {
    logger.error(`Error downloading assets: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
