import { afterEach, describe, expect, it, vi } from "vitest";

import { npDecodePluginActionResult, npDispatchPluginAction } from "./plugin-action-results.js";

describe("npDecodePluginActionResult", () => {
  it("accepts the base action envelope and preserves arbitrary data", () => {
    expect(npDecodePluginActionResult({ ok: true, data: { queued: true } }, "action")).toEqual({
      ok: true,
      data: { queued: true },
    });
    expect(npDecodePluginActionResult({ ok: false, error: "Nope" }, "action")).toEqual({
      ok: false,
      error: "Nope",
    });
  });

  it("rejects malformed base envelopes", () => {
    expect(npDecodePluginActionResult(null, "action")).toEqual({
      ok: false,
      error: "Malformed plugin action result: the response envelope must be an object.",
    });
    expect(npDecodePluginActionResult({ ok: "yes" }, "action")).toEqual({
      ok: false,
      error:
        'Malformed plugin action result: the response envelope must contain a boolean "ok" field.',
    });
    expect(npDecodePluginActionResult({ ok: false, error: 42 }, "action")).toEqual({
      ok: false,
      error:
        'Malformed plugin action result: the response envelope "error" field must be a string when provided.',
    });
    expect(npDecodePluginActionResult({ ok: false }, "action")).toEqual({
      ok: false,
      error: "Plugin action failed without an error message.",
    });
  });

  it("requires the complete metric shape instead of substituting a dash", () => {
    expect(
      npDecodePluginActionResult({ ok: true, data: { value: 0, delta: "No change" } }, "metric"),
    ).toEqual({ ok: true, data: { value: 0, delta: "No change" } });
    expect(npDecodePluginActionResult({ ok: true, data: { delta: "+2" } }, "metric")).toEqual({
      ok: false,
      error: "Malformed plugin action result: metric data.value must be a string or number.",
    });
    expect(
      npDecodePluginActionResult({ ok: true, data: { value: Number.POSITIVE_INFINITY } }, "metric"),
    ).toEqual({
      ok: false,
      error: "Malformed plugin action result: metric data.value must be finite.",
    });
  });

  it("requires a valid status level and message", () => {
    expect(
      npDecodePluginActionResult({ ok: true, data: { level: "ok", message: "Healthy" } }, "status"),
    ).toEqual({ ok: true, data: { level: "ok", message: "Healthy" } });
    expect(
      npDecodePluginActionResult(
        { ok: true, data: { level: "unknown", message: "Maybe" } },
        "status",
      ),
    ).toEqual({
      ok: false,
      error: 'Malformed plugin action result: status data.level must be "ok", "warn", or "error".',
    });
  });

  it("requires table rows to be objects and total to be finite", () => {
    expect(
      npDecodePluginActionResult({ ok: true, data: { rows: [{ id: "1" }], total: 1 } }, "table"),
    ).toEqual({ ok: true, data: { rows: [{ id: "1" }], total: 1 } });
    expect(
      npDecodePluginActionResult({ ok: true, data: { rows: [null], total: 1 } }, "table"),
    ).toEqual({
      ok: false,
      error: "Malformed plugin action result: every table row must be an object.",
    });
    expect(
      npDecodePluginActionResult({ ok: true, data: { rows: [], total: Number.NaN } }, "table"),
    ).toEqual({
      ok: false,
      error: "Malformed plugin action result: table data.total must be a finite number.",
    });
  });
});

describe("npDispatchPluginAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns network failures into an explicit action error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(npDispatchPluginAction("demo", "health", "status")).resolves.toEqual({
      ok: false,
      error: "Plugin action request failed: offline",
    });
  });

  it("rejects dot-segment action ids before constructing an Admin URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(npDispatchPluginAction("demo", "..", "action")).resolves.toEqual({
      ok: false,
      error: 'Plugin action id ".." cannot be dispatched through an Admin URL.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps scoped plugin ids inside one encoded URL segment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, data: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(npDispatchPluginAction("@acme/demo", "run", "action")).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/plugins/%40acme%2Fdemo/actions/run",
      expect.any(Object),
    );
  });

  it("turns a successful HTTP response with invalid JSON into a malformed-result error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));

    await expect(npDispatchPluginAction("demo", "health", "status")).resolves.toEqual({
      ok: false,
      error: "Malformed plugin action result: the response envelope must be an object.",
    });
  });
});
