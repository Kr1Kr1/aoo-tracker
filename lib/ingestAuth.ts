import { errorResponse } from "@/lib/api";

export function requireIngestSecret(
  request: Request,
  origin?: string | null
): Response | null {
  const expected = process.env.INGEST_SECRET;
  if (!expected) {
    return errorResponse("Ingest not configured", 503, origin);
  }
  const provided = request.headers.get("x-ingest-secret");
  if (!provided || provided !== expected) {
    return errorResponse("Unauthorized", 401, origin);
  }
  return null;
}
