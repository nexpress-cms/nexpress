import { describe, expect, it, vi } from "vitest";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function helpers() {
  // Each registry represents a separate worker, including a worker whose
  // cleanup permanently fails and must refuse subsequent database resets.
  vi.resetModules();
  return import("./work-scope.js");
}

describe("integration work cleanup", () => {
  it("keeps fixture resources and reset behind the entire abandoned body", async () => {
    const { createIntegrationWorkScope, settleIntegrationWork } = await helpers();
    const asserting = gate();
    const finish = gate();
    const stopped = gate();
    const disposing = gate();
    const disposed = gate();
    const events: string[] = [];
    const scope = createIntegrationWorkScope(
      () => {
        events.push("cancel");
        stopped.resolve();
      },
      async () => {
        events.push("disposing");
        disposing.resolve();
        await disposed.promise;
        events.push("disposed");
      },
    );
    const body = scope.run(async () => {
      await Promise.resolve(); // Executor completion is not body completion.
      events.push("asserting");
      asserting.resolve();
      await finish.promise;
      events.push("last database assertion");
    });
    await asserting.promise;
    const cleanup = scope.close();
    const reset = settleIntegrationWork().then(() => events.push("reset"));
    await stopped.promise;
    expect(scope.signal.aborted).toBe(true);
    expect(events).toEqual(["asserting", "cancel"]);
    finish.resolve();
    await disposing.promise;
    expect(events).toEqual(["asserting", "cancel", "last database assertion", "disposing"]);
    disposed.resolve();
    await Promise.all([body, cleanup, reset]);
    expect(events).toEqual([
      "asserting",
      "cancel",
      "last database assertion",
      "disposing",
      "disposed",
      "reset",
    ]);
  });

  it("preserves the original body rejection while cancellation and close remain idempotent", async () => {
    const { createIntegrationWorkScope, settleIntegrationWork } = await helpers();
    const started = gate();
    const finish = gate();
    const failure = new Error("original assertion after timeout");
    const stop = vi.fn(() => finish.resolve());
    const scope = createIntegrationWorkScope(stop);
    const body = scope.run(async () => {
      started.resolve();
      await finish.promise;
      throw failure;
    });
    const rejection = expect(body).rejects.toBe(failure);
    await started.promise;
    const closing = scope.close();
    expect(scope.close()).toBe(closing);
    await closing;
    await rejection;
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(scope.run(async () => "late work")).rejects.toThrow("scope is closed");
    await expect(settleIntegrationWork()).resolves.toBeUndefined();
  });

  it("drains work even when stop fails, then refuses every following reset", async () => {
    const { createIntegrationWorkScope, settleIntegrationWork } = await helpers();
    const finish = gate();
    const stopped = gate();
    const failure = new Error("fixture cancellation failed");
    const scope = createIntegrationWorkScope(() => {
      stopped.resolve();
      throw failure;
    });
    const body = scope.run(() => finish.promise);
    let completed = false;
    const closing = scope.close();
    const rejected = expect(closing).rejects.toBe(failure);
    void closing.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    await stopped.promise;
    expect(completed).toBe(false);
    finish.resolve();
    await body;
    await rejected;
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(settleIntegrationWork()).rejects.toMatchObject({ errors: [failure] });
    }
  });

  it("registers before invoking a body that requests its own cleanup synchronously", async () => {
    const { createIntegrationWorkScope, settleIntegrationWork } = await helpers();
    const finish = gate();
    const scope = createIntegrationWorkScope(() => {
      void scope.close();
    });
    let closing: Promise<void> | undefined;
    const body = scope.run(() => {
      closing = scope.close();
      return finish.promise;
    });
    await Promise.resolve();
    expect(closing).toBeDefined();
    let reset = false;
    const resetting = settleIntegrationWork().then(() => {
      reset = true;
    });
    await Promise.resolve();
    expect(reset).toBe(false);
    finish.resolve();
    await Promise.all([body, closing, resetting]);
    expect(reset).toBe(true);
  });

  it("keeps a failed resource disposal registered after the body has drained", async () => {
    const { createIntegrationWorkScope, settleIntegrationWork } = await helpers();
    const failure = new Error("provider fixture disposal failed");
    const scope = createIntegrationWorkScope(
      () => {},
      () => {
        throw failure;
      },
    );
    await scope.run(async () => "finished");
    await expect(scope.close()).rejects.toBe(failure);
    await expect(settleIntegrationWork()).rejects.toMatchObject({ errors: [failure] });
  });
});
