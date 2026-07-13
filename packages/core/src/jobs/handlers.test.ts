import { describe, expect, it, vi } from "vitest";

import {
  getJobHandler,
  getKnownJobTypes,
  normalizeRegisteredJobPayload,
  registerJobHandler,
} from "./handlers.js";

describe("custom job handler contracts", () => {
  it("runs an additive custom parser before enqueue and dispatch", async () => {
    const handler = vi.fn<(data: { documentId: string }) => Promise<void>>();
    registerJobHandler("search:reindex", handler, {
      parsePayload(data) {
        if (
          typeof data !== "object" ||
          data === null ||
          Object.keys(data).length !== 1 ||
          !("documentId" in data) ||
          typeof data.documentId !== "string" ||
          data.documentId.length === 0
        ) {
          throw new Error("documentId is required");
        }
        return { documentId: data.documentId };
      },
    });

    expect(normalizeRegisteredJobPayload("search:reindex", { documentId: "post-1" })).toEqual({
      documentId: "post-1",
    });
    expect(() => normalizeRegisteredJobPayload("search:reindex", {})).toThrow(
      "documentId is required",
    );

    await getJobHandler("search:reindex")?.({ documentId: "post-2" });
    expect(handler).toHaveBeenCalledWith({ documentId: "post-2" });
    await expect(getJobHandler("search:reindex")?.({ documentId: 42 })).rejects.toThrow(
      "documentId is required",
    );
  });

  it("rejects duplicate registrations and non-void handler outcomes", async () => {
    const handler = async (): Promise<void> => {};
    registerJobHandler("search:deduplicate", handler);
    expect(() => registerJobHandler("search:deduplicate", handler)).not.toThrow();
    expect(() => registerJobHandler("search:deduplicate", async () => {})).toThrow(
      'Job handler "search:deduplicate" is already registered.',
    );

    registerJobHandler("search:nonVoid", (() => Promise.resolve("unexpected")) as never);
    await expect(getJobHandler("search:nonVoid")?.({})).rejects.toThrow(
      'Job handler "search:nonVoid" must resolve to void.',
    );
    expect(() =>
      registerJobHandler("search:badOptions", async () => {}, { extra: true } as never),
    ).toThrow("must contain only parsePayload");
    const accessorOptions = Object.defineProperty({}, "parsePayload", {
      enumerable: true,
      get: () => undefined,
    });
    expect(() =>
      registerJobHandler("search:accessorOptions", async () => {}, accessorOptions),
    ).toThrow("must contain only parsePayload");
    expect(getKnownJobTypes()).toEqual(
      expect.arrayContaining(["media:processImage", "search:deduplicate", "search:nonVoid"]),
    );
  });
});
