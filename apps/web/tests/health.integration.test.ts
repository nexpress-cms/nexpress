import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { setJobQueue } from "@nexpress/core";

import { GET } from "@/app/api/health/route";
import { GET as readyGET } from "@/app/api/health/ready/route";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
} from "./harness.js";

describe("GET /api/health (liveness)", () => {
  it("returns ok + timestamp", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      timestamp: number;
    };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("number");
  });
});

describe.skipIf(skipIfNoTestDb())("GET /api/health/ready (readiness)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("returns 200 with all probes ok when DB + storage are wired", async () => {
    const response = await readyGET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      probes: {
        db: { ok: boolean };
        storage: { ok: boolean };
        queue: { ok: boolean; enabled: boolean };
      };
    };
    expect(body.status).toBe("ok");
    expect(body.probes.db.ok).toBe(true);
    expect(body.probes.storage.ok).toBe(true);
    // Queue is optional; harness doesn't wire pg-boss, so
    // `enabled` is false but `ok` stays true (not configured
    // ≠ broken).
    expect(body.probes.queue.ok).toBe(true);
    expect(body.probes.queue.enabled).toBe(false);
  });

  it("sets Cache-Control: no-store so the probe always reflects current state", async () => {
    const response = await readyGET();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  describe("queue probe — isHealthy round-trip (Phase 22.4)", () => {
    afterEach(() => {
      // Reset the queue singleton so the surrounding test cases
      // (which expect `enabled: false`) keep their preconditions.
      setJobQueue(null);
    });

    it("reports enabled + ok when the wired adapter says it's healthy", async () => {
      setJobQueue({
        enqueue: () => Promise.resolve(""),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        isHealthy: () => Promise.resolve(true),
      });
      const response = await readyGET();
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        probes: { queue: { ok: boolean; enabled: boolean; detail?: string } };
      };
      expect(body.probes.queue).toMatchObject({ ok: true, enabled: true });
      expect(body.status).toBe("ok");
    });

    it("returns 503 + degraded when the wired adapter reports unhealthy", async () => {
      setJobQueue({
        enqueue: () => Promise.resolve(""),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        isHealthy: () => Promise.resolve(false),
      });
      const response = await readyGET();
      expect(response.status).toBe(503);
      const body = (await response.json()) as {
        status: string;
        probes: { queue: { ok: boolean; enabled: boolean; detail?: string } };
      };
      expect(body.probes.queue).toMatchObject({ ok: false, enabled: true });
      expect(body.probes.queue.detail).toBeTruthy();
      expect(body.status).toBe("degraded");
    });

    it("surfaces the error message when isHealthy throws", async () => {
      setJobQueue({
        enqueue: () => Promise.resolve(""),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        isHealthy: () => Promise.reject(new Error("ECONNREFUSED")),
      });
      const response = await readyGET();
      expect(response.status).toBe(503);
      const body = (await response.json()) as {
        probes: { queue: { ok: boolean; detail?: string } };
      };
      expect(body.probes.queue.ok).toBe(false);
      expect(body.probes.queue.detail).toContain("ECONNREFUSED");
    });
  });
});
