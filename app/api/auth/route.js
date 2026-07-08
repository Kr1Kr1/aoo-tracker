import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jsonResponse, errorResponse, preflight } from "@/lib/api";
import bcrypt from "bcrypt";
import * as jose from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

async function issueToken(user) {
  return new jose.SignJWT({ userId: user.id, username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(JWT_SECRET);
}

function authCookie(token) {
  // Local-only deployment: SameSite=Lax is enough; Secure would prevent
  // dev over plain http://localhost. HttpOnly keeps the token out of JS.
  const maxAge = 60 * 60 * 24 * 7; // 7 days
  return `auth-token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return errorResponse("Username and password required", 400, origin);
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      logger.warn(`Login attempt for non-existent user: ${username}`);
      return errorResponse("Invalid credentials", 401, origin);
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      logger.warn(`Invalid password attempt for user: ${username}`);
      return errorResponse("Invalid credentials", 401, origin);
    }

    const token = await issueToken(user);
    logger.info(`Successful login: ${username}`);

    const response = jsonResponse({ token, username: user.username }, { origin });
    response.headers.append("Set-Cookie", authCookie(token));
    return response;
  } catch (err) {
    logger.error(`Auth error: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal server error", 500, origin);
  }
}

// Registration is gated by REGISTRATION_SECRET to prevent random users from
// creating accounts on this otherwise-private dashboard. Set the env var to
// a non-empty string to enable, leave empty/undefined to disable entirely.
export async function PUT(request) {
  const origin = request.headers.get("origin");
  try {
    const { username, password, registrationSecret } = await request.json();

    const expected = process.env.REGISTRATION_SECRET;
    if (!expected) {
      logger.warn("Registration attempted but REGISTRATION_SECRET is not configured");
      return errorResponse("Registration is disabled", 403, origin);
    }
    if (registrationSecret !== expected) {
      logger.warn(`Registration attempt with invalid secret for username: ${username}`);
      return errorResponse("Invalid registration secret", 403, origin);
    }
    if (!username || !password) {
      return errorResponse("Username and password required", 400, origin);
    }

    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return errorResponse("Username already taken", 400, origin);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, password: hashedPassword },
    });

    const token = await issueToken(user);
    logger.info(`New user registered: ${username}`);

    const response = jsonResponse({ token, username: user.username }, { origin });
    response.headers.append("Set-Cookie", authCookie(token));
    return response;
  } catch (err) {
    logger.error(`Registration error: ${err.message}`, { stack: err.stack });
    return errorResponse("Internal server error", 500, origin);
  }
}

export async function DELETE(request) {
  const origin = request.headers.get("origin");
  const response = jsonResponse({ ok: true }, { origin });
  response.headers.append(
    "Set-Cookie",
    "auth-token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  return response;
}

export async function OPTIONS(request) {
  return preflight(request.headers.get("origin"));
}
