import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight, parseTargetId } from "@/lib/api";
import { getCallerContext, isAdmin } from "@/lib/authContext";
import bcrypt from "bcrypt";

async function requireAdmin(request) {
  const ctx = await getCallerContext(request);
  if (!ctx) return { error: errorResponse("Unauthorized", 401, request.headers.get("origin")) };
  if (!isAdmin(ctx)) return { error: errorResponse("Forbidden", 403, request.headers.get("origin")) };
  return { ctx };
}

export async function PATCH(request, context) {
  const origin = request.headers.get("origin");
  const guard = await requireAdmin(request);
  if (guard.error) return guard.error;

  try {
    const { id } = await context.params;
    const userId = parseTargetId(id);
    if (userId === null) return errorResponse("Invalid user id", 400, origin);

    const body = await request.json();
    const { role, password, characterTargetIds } = body;

    const data = {};
    if (role) {
      if (role !== "user" && role !== "admin") {
        return errorResponse("role must be 'user' or 'admin'", 400, origin);
      }
      data.role = role;
    }
    if (password) data.password = await bcrypt.hash(password, 10);
    if (Array.isArray(characterTargetIds)) {
      data.characters = {
        set: characterTargetIds.map((targetId) => ({ targetId })),
      };
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        role: true,
        characters: { select: { targetId: true, name: true } },
      },
    });

    logger.info(`Admin updated user ${updated.username}`);
    return jsonResponse(updated, { origin });
  } catch (err) {
    if (err.code === "P2025") return errorResponse("User not found", 404, origin);
    logger.error(`Error updating user: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function DELETE(request, context) {
  const origin = request.headers.get("origin");
  const guard = await requireAdmin(request);
  if (guard.error) return guard.error;

  try {
    const { id } = await context.params;
    const userId = parseTargetId(id);
    if (userId === null) return errorResponse("Invalid user id", 400, origin);

    if (userId === guard.ctx.userId) {
      return errorResponse("Cannot delete your own account", 400, origin);
    }

    await prisma.user.delete({ where: { id: userId } });
    logger.info(`Admin deleted user ${userId}`);
    return jsonResponse({ ok: true }, { origin });
  } catch (err) {
    if (err.code === "P2025") return errorResponse("User not found", 404, origin);
    logger.error(`Error deleting user: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
