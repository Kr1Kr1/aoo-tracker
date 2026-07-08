import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as jose from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/map-snapshots") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/assets")
  ) {
    return NextResponse.next();
  }

  const token =
    request.cookies.get("auth-token")?.value ||
    request.headers.get("authorization")?.split(" ")[1];

  if (!token) {
    if (!pathname.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return new NextResponse("Authentication required", { status: 401 });
  }

  try {
    await jose.jwtVerify(token, JWT_SECRET);
    // Admin gating: route handlers re-check via DB (authoritative). The
    // middleware doesn't see the role here because we don't put it in the
    // JWT — keeps the token small and avoids stale-role issues.
    return NextResponse.next();
  } catch {
    if (!pathname.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return new NextResponse("Invalid token", { status: 401 });
  }
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
