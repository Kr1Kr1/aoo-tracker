import { getCallerContext, canAccessTargetId } from "@/lib/authContext";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";

// Sets the "acting-as" cookie. Body: { targetId: number | null }.
// null clears the cookie (= back to "show all my characters").
export async function POST(request) {
  const origin = request.headers.get("origin");
  const ctx = await getCallerContext(request);
  if (!ctx) return errorResponse("Unauthorized", 401, origin);

  const { targetId } = await request.json();

  const response = jsonResponse({ ok: true, actingAsTargetId: targetId ?? null }, { origin });

  if (targetId === null || targetId === undefined) {
    response.headers.append(
      "Set-Cookie",
      "acting-as=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    );
    return response;
  }

  if (typeof targetId !== "number" || !Number.isFinite(targetId)) {
    return errorResponse("targetId must be a number or null", 400, origin);
  }
  if (!canAccessTargetId(ctx, targetId)) {
    return errorResponse("Forbidden: targetId not linked to this user", 403, origin);
  }

  response.headers.append(
    "Set-Cookie",
    `acting-as=${targetId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );
  return response;
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
