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

  it("warns when LocalStorageAdapter runs under NP_MULTI_NODE=true", () => {
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

  it("does not warn about local storage when NP_MULTI_NODE is unset", () => {
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

  it("accepts NP_MULTI_NODE=1 as truthy alongside 'true'", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "1",
    });
    expect(warnings.some((w) => w.message.includes("multi-node safe"))).toBe(true);
  });

  it("warns about a missing NP_SECRET in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: null,
      nodeEnv: "production",
      multiNodeFlag: undefined,
    });
    expect(emitted).toContain("missing_prod_secret");
    expect(warnings.some((w) => w.message.includes("NP_SECRET is unset"))).toBe(true);
  });

  it("warns about a short NP_SECRET in production", () => {
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

  it("container-hint warning message lists every recognized platform env var", () => {
    // Regression guard: bootstrap.ts and the warning message in
    // safety-check.ts list the same env vars in two separate places.
    // If someone adds RAILWAY_ENVIRONMENT_NAME (or the next platform)
    // to bootstrap.ts but forgets the message string here, operators
    // see a warning that doesn't tell them which env triggered it.
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      containerEnv: true,
    });
    const message = warnings.find((w) => w.message.includes("multi-node safe"))?.message ?? "";
    for (const envVar of [
      "KUBERNETES_SERVICE_HOST",
      "FLY_REGION",
      "RENDER_INSTANCE_ID",
      "RAILWAY_ENVIRONMENT_NAME",
    ]) {
      expect(message, `warning should mention ${envVar}`).toContain(envVar);
    }
  });

  it("explicit NP_MULTI_NODE=false silences the container hint", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "false",
      containerEnv: true,
    });
    expect(emitted).not.toContain("multi_node_local_storage");
    expect(warnings).toEqual([]);
  });
});
