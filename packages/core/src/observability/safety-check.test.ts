import { afterEach, describe, expect, it } from "vitest";

import { resetLogger, setLogger } from "./logger.js";
import { verifyStartupSafety } from "./safety-check.js";

interface CapturedWarning {
  message: string;
  context: Record<string, unknown> | undefined;
}

function captureWarnings(): {
  warnings: CapturedWarning[];
  restore: () => void;
} {
  const warnings: CapturedWarning[] = [];
  setLogger({
    debug: () => {},
    info: () => {},
    warn: (message, context) => {
      warnings.push({ message, context });
    },
    error: () => {},
  });
  return {
    warnings,
    restore: resetLogger,
  };
}

describe("verifyStartupSafety", () => {
  afterEach(() => {
    resetLogger();
  });

  it("emits no warnings on a clean dev config", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "doesnt-matter-in-dev",
      nodeEnv: "development",
      multiNodeFlag: undefined,
    });
    expect(emitted).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("warns when LocalStorageAdapter runs under NX_MULTI_NODE=true", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "true",
    });
    expect(emitted).toContain("multi_node_local_storage");
    expect(warnings.some((w) => w.message.includes("multi-node safe"))).toBe(true);
  });

  it("does not warn about local storage when NX_MULTI_NODE is unset", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
    });
    expect(emitted).not.toContain("multi_node_local_storage");
    expect(warnings).toEqual([]);
  });

  it("accepts NX_MULTI_NODE=1 as truthy alongside 'true'", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "1",
    });
    expect(warnings.some((w) => w.message.includes("multi-node safe"))).toBe(true);
  });

  it("warns about a missing NX_SECRET in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: null,
      nodeEnv: "production",
      multiNodeFlag: undefined,
    });
    expect(emitted).toContain("missing_prod_secret");
    expect(warnings.some((w) => w.message.includes("NX_SECRET is unset"))).toBe(true);
  });

  it("warns about a short NX_SECRET in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "tiny",
      nodeEnv: "production",
      multiNodeFlag: undefined,
    });
    expect(emitted).toContain("weak_prod_secret");
    expect(warnings.find((w) => w.message.includes("shorter than"))?.context).toMatchObject({
      length: 4,
    });
  });

  it("does not warn about a short secret outside production", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "tiny",
      nodeEnv: "development",
      multiNodeFlag: undefined,
    });
    expect(warnings).toEqual([]);
  });

  it("returns ids in deterministic order so callers can snapshot them", () => {
    const { warnings: _w } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: null,
      nodeEnv: "production",
      multiNodeFlag: "true",
    });
    expect(emitted).toEqual(["multi_node_local_storage", "missing_prod_secret"]);
  });

  it("warns about local storage when a managed-container env var is detected in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      containerEnv: true,
    });
    expect(emitted).toContain("multi_node_local_storage");
    const warning = warnings.find((w) => w.message.includes("multi-node safe"));
    expect(warning?.context).toMatchObject({ reason: "container_hint" });
  });

  it("does not warn about container hints outside production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "development",
      multiNodeFlag: undefined,
      containerEnv: true,
    });
    expect(emitted).not.toContain("multi_node_local_storage");
    expect(warnings).toEqual([]);
  });

  it("attributes the warning to the explicit flag when both signals are present", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "true",
      containerEnv: true,
    });
    const warning = warnings.find((w) => w.message.includes("multi-node safe"));
    expect(warning?.context).toMatchObject({ reason: "explicit_flag" });
  });
});
