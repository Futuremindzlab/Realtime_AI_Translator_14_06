import { NextRequest, NextResponse } from "next/server";

// Site-wide reachability gate, in front of every page — including the
// Cognito sign-in form itself. This is NOT the real access-control boundary
// (every OWNER-only API route already enforces getRole(event) === 'OWNER'
// server-side, and /v1/translations, /v1/billing/history scope strictly by
// the caller's own Cognito sub) — it just keeps this dashboard's existence,
// and payment data behind it, off the open internet for anyone who doesn't
// have this one shared credential, since Cognito sign-up on the mobile app
// side is self-serve and not itself a "this person should see this URL"
// signal.
//
// Configure DASHBOARD_ACCESS_USER / DASHBOARD_ACCESS_PASSWORD in the hosting
// environment (Vercel project settings → Environment Variables) — deliberately
// NOT prefixed NEXT_PUBLIC_, so it never ships to the client bundle. Left
// unset, this gate is a no-op (so local `npm run dev` needs no extra setup).
export function middleware(request: NextRequest) {
  const requiredUser = process.env.DASHBOARD_ACCESS_USER;
  const requiredPassword = process.env.DASHBOARD_ACCESS_PASSWORD;
  if (!requiredUser || !requiredPassword) return NextResponse.next();

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");
    const suppliedUser = decoded.slice(0, separatorIndex);
    const suppliedPassword = decoded.slice(separatorIndex + 1);
    if (suppliedUser === requiredUser && suppliedPassword === requiredPassword) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="OneLingo Dashboards"' },
  });
}

export const config = {
  // Every path except Next.js's own static assets — those need no gating
  // and gating them anyway would just add latency to every page load.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
