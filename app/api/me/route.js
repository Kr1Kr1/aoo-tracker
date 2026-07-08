import { getCallerContext } from "@/lib/authContext";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import prisma from "@/lib/prisma";

// Returns the current user's identity + linked characters + active "acting as".
export async function GET(request) {
  const origin = request.headers.get("origin");
  const ctx = await getCallerContext(request);
  if (!ctx) return errorResponse("Unauthorized", 401, origin);

  const characters = await prisma.characters.findMany({
    where: { targetId: { in: ctx.characterTargetIds } },
    select: { targetId: true, name: true, faction: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  // Active character's last known map position. Used by the map page to
  // open on "where I am right now" instead of the first plan with data.
  // Picks the acting-as character when set, else the first linked character.
  const activeTargetId =
    ctx.actingAsTargetId ?? ctx.characterTargetIds[0] ?? null;
  let location = null;
  if (activeTargetId != null) {
    const c = await prisma.characters.findUnique({
      where: { targetId: activeTargetId },
      select: {
        targetId: true,
        name: true,
        coords: { select: { x: true, y: true, z: true, plan: true } },
      },
    });
    if (c?.coords) {
      location = {
        targetId: c.targetId,
        characterName: c.name,
        plan: c.coords.plan,
        z: c.coords.z,
        x: c.coords.x,
        y: c.coords.y,
      };
    }
  }

  return jsonResponse(
    {
      userId: ctx.userId,
      username: ctx.username,
      role: ctx.role,
      actingAsTargetId: ctx.actingAsTargetId,
      characters,
      location,
    },
    { origin }
  );
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
