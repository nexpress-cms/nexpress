import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  stopSiteBuildRenderProcessV1,
  type NpSiteBuildRenderProcessV1,
} from "./render-driver-process.js";

const processes: NpSiteBuildRenderProcessV1[] = [];
afterEach(async () => {
  await Promise.all(
    processes.splice(0).map(async (owned) => {
      if (!owned.exited()) owned.child.kill("SIGKILL");
      await owned.closed;
    }),
  );
});

async function service(
  shutdownSignal: NpSiteBuildRenderProcessV1["shutdownSignal"],
): Promise<NpSiteBuildRenderProcessV1> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      'process.on("SIGTERM", () => {}); process.on("SIGINT", () => process.exit(0)); setInterval(() => {}, 1000); process.stdout.write("ready\\n");',
    ],
    { env: {}, stdio: ["ignore", "pipe", "ignore"] },
  );
  let ended = false;
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      ended = true;
      reject(error);
    });
    child.once("close", () => {
      ended = true;
      resolve();
    });
  });
  void closed.catch(() => {});
  const owned = { child, closed, exited: () => ended, shutdownSignal };
  processes.push(owned);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", (bytes: Buffer) => {
      if (bytes.toString() === "ready\n") resolve();
      else reject(new Error("unexpected-service-readiness"));
    });
  });
  return owned;
}

describe("fixed render service shutdown", () => {
  it("waits for the actual child to close after its selected graceful signal", async () => {
    const owned = await service("SIGINT");
    await expect(stopSiteBuildRenderProcessV1(owned)).resolves.toBeUndefined();
    expect(owned.exited()).toBe(true);
    expect(owned.child.exitCode).toBe(0);
    expect(owned.child.signalCode).toBeNull();
  });

  it("reaps an unresponsive service but refuses to count SIGKILL as a normal stop", async () => {
    const owned = await service("SIGTERM");
    await expect(stopSiteBuildRenderProcessV1(owned)).rejects.toThrow("fixed-service-forced-stop");
    expect(owned.exited()).toBe(true);
    expect(owned.child.signalCode).toBe("SIGKILL");
  });
});
