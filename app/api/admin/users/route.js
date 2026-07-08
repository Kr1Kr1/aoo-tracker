import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import { getCallerContext, isAdmin } from "@/lib/authContext";
import bcrypt from "bcrypt";

async function requireAdmin(request) {
  const ctx = await getCallerContext(request);
  if (!ctx) return { error: errorResponse("Unauthorized", 401, request.headers.get("origin")) };
  if (!isAdmin(ctx)) return { error: errorResponse("Forbidden", 403, request.headers.get("origin")) };
  return { ctx };
}

export async function GET(request) {
  const origin = request.headers.get("origin");
  const { error } = await requireAdmin(request);
  if (error) return error;

  const users = await prisma.user.findMany({
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      role: true,
      createdAt: true,
      characters: { select: { targetId: true, name: true } },
    },
  });
  return jsonResponse(users, { origin });
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const { username, password, role = "user", characterTargetIds = [] } = await request.json();
    if (!username || !password) {
      return errorResponse("username and password required", 400, origin);
    }
    if (role !== "user" && role !== "admin") {
      return errorResponse("role must be 'user' or 'admin'", 400, origin);
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return errorResponse("Username already taken", 409, origin);

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        password: hashed,
        role,
        characters: {
          connect: characterTargetIds.map((targetId) => ({ targetId })),
        },
      },
      select: {
        id: true,
        username: true,
        role: true,
        characters: { select: { targetId: true, name: true } },
      },
    });

    logger.info(`Admin created user ${username} (role=${role})`);
    return jsonResponse(user, { origin });
  } catch (err) {
    logger.error(`Error creating user: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal Server Error", 500, origin);
  }
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
