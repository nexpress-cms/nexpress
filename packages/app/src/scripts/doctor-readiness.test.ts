import { describe, expect, it } from "vitest";

import {
  checkStorageProd,
  checkTargetStorageProd,
  checkTargetWorkerProd,
} from "./doctor-readiness.js";

describe("doctor production target readiness", () => {
  it("keeps target checks out of the default dev doctor path", () => {
    expect(checkTargetStorageProd(false, "vercel", { NP_STORAGE_ADAPTER: "local" })).toEqual([]);
    expect(checkTargetWorkerProd(false, "vercel", { NP_ENABLE_JOBS: "1" })).toEqual([]);
    expect(checkStorageProd(false, "docker", { NP_MULTI_NODE: "true" })).toBeNull();
  });

  it("requires S3-compatible storage for Vercel", () => {
    expect(checkTargetStorageProd(true, "vercel", { NP_STORAGE_ADAPTER: "local" })).toEqual([
      expect.objectContaining({
        state: "error",
        label: "Vercel storage",
        detail: "NP_STORAGE_ADAPTER=local",
      }),
    ]);

    expect(checkTargetStorageProd(true, "vercel", { NP_STORAGE_ADAPTER: "s3" })).toEqual([
      expect.objectContaining({
        state: "ok",
        label: "Vercel storage",
        detail: "S3-compatible",
      }),
    ]);
  });

  it("warns when Vercel jobs are enabled without a long-running worker host", () => {
    expect(checkTargetWorkerProd(true, "vercel", { NP_ENABLE_JOBS: "1" })).toEqual([
      expect.objectContaining({
        state: "warn",
        label: "Vercel jobs worker",
      }),
    ]);

    expect(checkTargetWorkerProd(true, "railway", { NP_ENABLE_JOBS: "true" })).toEqual([
      expect.objectContaining({
        state: "ok",
        label: "Railway jobs worker",
      }),
    ]);
  });

  it("errors on local storage for managed container targets unless explicitly single-node", () => {
    for (const target of ["railway", "render", "fly"] as const) {
      expect(checkTargetStorageProd(true, target, { NP_STORAGE_ADAPTER: "local" })).toEqual([
        expect.objectContaining({
          state: "error",
          detail: "local storage",
        }),
      ]);

      expect(
        checkTargetStorageProd(true, target, {
          NP_STORAGE_ADAPTER: "local",
          NP_MULTI_NODE: "false",
        }),
      ).toEqual([
        expect.objectContaining({
          state: "warn",
          detail: "local + NP_MULTI_NODE=false",
        }),
      ]);

      expect(checkTargetStorageProd(true, target, { NP_STORAGE_ADAPTER: "s3" })).toEqual([
        expect.objectContaining({
          state: "ok",
          detail: "s3",
        }),
      ]);
    }
  });

  it("keeps Docker generic multi-node storage checks active", () => {
    expect(
      checkStorageProd(true, "docker", {
        NP_STORAGE_ADAPTER: "local",
        NP_MULTI_NODE: "true",
      }),
    ).toEqual(
      expect.objectContaining({
        state: "error",
        label: "Storage adapter (production)",
        detail: "local + NP_MULTI_NODE=true",
      }),
    );

    expect(
      checkStorageProd(true, "docker", {
        NP_STORAGE_ADAPTER: "local",
        NP_MULTI_NODE: "false",
      }),
    ).toEqual(
      expect.objectContaining({
        state: "ok",
        label: "Storage adapter (production): local",
      }),
    );
  });
});
