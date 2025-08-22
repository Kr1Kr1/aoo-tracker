import { NextResponse } from 'next/server';
import { logger } from "@/lib/logger";
import { PrismaClient } from "@prisma/client";
import bcrypt from 'bcrypt';
import * as jose from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key'
);
const prisma = new PrismaClient();

// Login endpoint
export async function POST(request) {
  try {
    const { username, password } = await request.json();
    logger.debug(`[API] Auth request for username: ${username}`);

    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      logger.warn(`[API] Login attempt for non-existent user: ${username}`);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      logger.warn(`[API] Invalid password attempt for user: ${username}`);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Create JWT
    const token = await new jose.SignJWT({ 
      userId: user.id, 
      username: user.username 
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(JWT_SECRET);

    logger.info(`[API] Successful login for user: ${username}`);
    return NextResponse.json({ token });
  } catch (error) {
    logger.error(`[API] Auth error: ${error.message}`, { stack: error.stack });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Registration endpoint
export async function PUT(request) {
  try {
    const { username, password } = await request.json();
    logger.debug(`[API] Registration request for username: ${username}`);

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({
      where: { username }
    });

    if (existingUser) {
      logger.warn(`[API] Registration attempt with existing username: ${username}`);
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword
      }
    });

    // Create JWT
    const token = await new jose.SignJWT({ 
      userId: user.id, 
      username: user.username 
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(JWT_SECRET);

    logger.info(`[API] Successfully registered new user: ${username}`);
    return NextResponse.json({ token });
  } catch (error) {
    logger.error(`[API] Registration error: ${error.message}`, { stack: error.stack });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
