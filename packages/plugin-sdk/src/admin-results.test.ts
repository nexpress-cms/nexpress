import { describe, expect, it } from "vitest";

import { npAdminActionError, npAdminMetric, npAdminStatus, npAdminTable } from "./admin-results.js";
import type { NpPluginContext } from "./types.js";

describe("admin result helpers", () => {
  it("builds metric results", () => {
    expect(npAdminMetric(42, "+4")).toEqual({
      ok: true,
      data: { value: 42, delta: "+4" },
    });
  });

  it("builds status results", () => {
    expect(npAdminStatus("ok", "Healthy")).toEqual({
      ok: true,
      data: { level: "ok", message: "Healthy" },
    });
  });

  it("builds table results with inferred totals", () => {
    expect(npAdminTable([{ path: "/", views: 3 }])).toEqual({
      ok: true,
      data: { rows: [{ path: "/", views: 3 }], total: 1 },
    });
  });

  it("builds action errors", () => {
    expect(npAdminActionError("Nope")).toEqual({ ok: false, error: "Nope" });
  });

  it("types action registration helpers by admin result shape", () => {
    function register(ctx: NpPluginContext) {
      ctx.actions.registerMetric("views", () => Promise.resolve(npAdminMetric(12)));
      ctx.actions.registerStatus("health", () => Promise.resolve(npAdminStatus("ok", "Healthy")));
      ctx.actions.registerTable("rows", () =>
        Promise.resolve(npAdminTable([{ path: "/", views: 1 }])),
      );
    }

    expect(typeof register).toBe("function");
  });
});
