import { NextResponse } from "next/server";

/**
 * Liveness probe — answers "is this process alive?" with a
 * cheap, dependency-free response. Load balancers and
 * container orchestrators (k8s `livenessProbe`) hit this on
 * a tight schedule; we want it to never touch the DB or
 * external services so a transient outage downstream
 * doesn't cascade into the worker getting restart-looped.
 *
 * For "is this process ready to serve real traffic?" use the
 * readiness probe at `/api/health/ready` instead.
 */
export function GET() {
  return NextResponse.json({ status: "ok", timestamp: Date.now() });
}

export const dynamic = "force-dynamic";
