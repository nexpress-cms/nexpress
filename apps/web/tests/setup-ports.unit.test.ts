import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  findFreePort,
  isPortFree,
} from "@nexpress/app/scripts/setup-server-ports";

/**
 * Pick a port that the OS confirms is currently bindable, then close
 * the listener and hand the (now free) port back. Tests bind the
 * same port we returned to simulate a port that's "in use" without
 * relying on a hardcoded number that another developer process
 * might happen to hold.
 */
async function reserveAndRelease(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const addr = server.address();
      const port =
        addr && typeof addr === "object" ? addr.port : Number.NaN;
      server.close(() => {
        if (Number.isInteger(port)) resolve(port);
        else reject(new Error("Couldn't read OS-assigned port"));
      });
    });
    server.listen(0, "127.0.0.1");
  });
}

describe("setup-server-ports", () => {
  const openServers: Server[] = [];

  function holdPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.once("listening", () => {
        openServers.push(server);
        resolve();
      });
      server.listen(port, "127.0.0.1");
    });
  }

  afterEach(async () => {
    await Promise.all(
      openServers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
          }),
      ),
    );
  });

  it("isPortFree returns true for an unbound port and false once we hold it", async () => {
    const port = await reserveAndRelease();
    expect(await isPortFree(port)).toBe(true);
    await holdPort(port);
    expect(await isPortFree(port)).toBe(false);
  });

  it("findFreePort returns the start when start is itself free", async () => {
    const port = await reserveAndRelease();
    const found = await findFreePort(port, 5);
    expect(found).toBe(port);
  });

  it("findFreePort skips a held port and returns the next free slot", async () => {
    // Reserve two consecutive ports, hold the first, expect findFreePort
    // to return the second. Using reserveAndRelease+1 is fragile (the
    // next port might be in use too) — better: hold ONE port and look
    // immediately above it. The OS gives us a guaranteed-free port via
    // reserveAndRelease, so port+1 SHOULD be free more often than not;
    // we use a generous count to absorb the rare collision.
    const heldPort = await reserveAndRelease();
    await holdPort(heldPort);
    const found = await findFreePort(heldPort, 50);
    expect(found).not.toBe(heldPort);
    expect(found).toBeGreaterThan(heldPort);
  });

  it("findFreePort returns null when the entire scan range is held", async () => {
    // Hold one port, then ask findFreePort to look at JUST that port
    // (count=1, start=heldPort). With no slots above to check, we
    // expect null.
    const heldPort = await reserveAndRelease();
    await holdPort(heldPort);
    const found = await findFreePort(heldPort, 1);
    expect(found).toBeNull();
  });

  it("findFreePort skips ports outside the usable 1024-65535 range", async () => {
    // Start at 65530 with count=10 — only 65530..65535 are valid; the
    // rest (65536..65539) get skipped. We can't easily guarantee 65530
    // is free in the test env, but we CAN assert the return is either
    // null or inside the valid range.
    const found = await findFreePort(65530, 10);
    if (found !== null) {
      expect(found).toBeGreaterThanOrEqual(1024);
      expect(found).toBeLessThanOrEqual(65535);
    }
  });
});
