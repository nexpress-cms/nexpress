import {
  getOptionalJobQueue,
  getStorageAdapter,
} from "@nexpress/core";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ensureFor } from "@/lib/init-core";
import { getDb } from "@/lib/db";

/**
 * Readiness probe — answers "is this process ready to serve
 * real traffic?" by checking each external dependency the
 * app needs to handle a typical request:
 *
 *   - **db** — `SELECT 1` round-trip via the configured pool
 *   - **storage** — verifies the adapter is wired (local
 *     dir resolves, S3 client constructed). We don't fire a
 *     network call against S3 here because that would slow
 *     the probe and a transient S3 hiccup shouldn't take a
 *     whole pod out of rotation.
 *   - **queue** — optional. Reports whether pg-boss is wired
 *     up; not having it doesn't fail readiness (sites can
 *     run without `NX_ENABLE_JOBS=1`).
 *
 * Returns 200 + per-probe status when every required check
 * passes; 503 with the same shape when any required check
 * fails. Container orchestrators (k8s `readinessProbe`)
 * pull pods out of rotation on non-200 without restarting
 * them.
 *
 * Public endpoint (no auth) so external uptime monitors
 * and load balancers can reach it. The response shape is
 * the only signal — no sensitive data is exposed.
 */

interface ProbeResult {
  ok: boolean;
  detail?: string;
}

interface ReadinessResponse {
  status: "ok" | "degraded";
  timestamp: number;
  probes: {
    db: ProbeResult;
    storage: ProbeResult;
    queue: ProbeResult & { enabled: boolean };
  };
}

async function probeDb(): Promise<ProbeResult> {
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function probeStorage(): ProbeResult {
  try {
    const adapter = getStorageAdapter();
    // Adapter exists implies bootstrap wired the configured
    // backend (`createStorageAdapter` validated the config
    // shape at boot). Constructing it surfaces broken config
    // (missing bucket, missing baseUrl) immediately; we
    // don't network here.
    return { ok: !!adapter };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeQueue(): Promise<ProbeResult & { enabled: boolean }> {
  const queue = getOptionalJobQueue();
  if (!queue) {
    // Queue is intentionally optional — many sites run
    // without pg-boss. Report it but don't fail readiness.
    return { ok: true, enabled: false, detail: "not configured" };
  }
  // Phase 22.4 — when the adapter exposes `isHealthy`, do a real
  // round-trip (pg-boss `isInstalled()` is a single SELECT against
  // `pgboss.version`). Adapters that don't implement it are
  // assumed healthy; the probe never fails on a missing answer.
  if (typeof queue.isHealthy === "function") {
    try {
      const ok = await queue.isHealthy();
      return ok
        ? { ok: true, enabled: true }
        : { ok: false, enabled: true, detail: "queue backend unhealthy" };
    } catch (error) {
      return {
        ok: false,
        enabled: true,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: true, enabled: true };
}

export async function GET() {
  await ensureFor("read");
  const [db, storage, queue] = await Promise.all([probeDb(), Promise.resolve(probeStorage()), probeQueue()]);

  const allOk = db.ok && storage.ok && queue.ok;
  const body: ReadinessResponse = {
    status: allOk ? "ok" : "degraded",
    timestamp: Date.now(),
    probes: { db, storage, queue },
  };
  return NextResponse.json(body, {
    status: allOk ? 200 : 503,
    headers: {
      // Probes must always reflect current state. CDN /
      // reverse-proxy caching here would mask outages.
      "Cache-Control": "no-store",
    },
  });
}

export const dynamic = "force-dynamic";
