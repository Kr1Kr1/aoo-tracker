import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key'
);

export async function middleware(request: NextRequest) {
  // Allow access to login page and auth API
  if (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname.startsWith('/api/auth') ||
    request.nextUrl.pathname.startsWith('/_next') ||
    request.nextUrl.pathname.startsWith('/assets')
  ) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get('auth-token')?.value;
  const headerToken = request.headers.get('authorization')?.split(' ')[1];
  const token = cookieToken || headerToken;

  console.log('[Middleware] Cookie Token:', cookieToken);
  console.log('[Middleware] Header Token:', headerToken);
  console.log('[Middleware] Final Token:', token);

  if (!token) {
    // Redirect to login for page requests
    if (!request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return new NextResponse('Authentication required', { status: 401 });
  }

  try {
    await jose.jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch (error) {
    console.log('[Middleware] Token verification failed:', error);
    // Redirect to login for page requests
    if (!request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return new NextResponse('Invalid token', { status: 401 });
  }
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
