import { describe, expect, it, vi } from "vitest";

import {
  getJobHandler,
  getKnownJobTypes,
  normalizeRegisteredJobPayload,
  registerJobHandler,
} from "./handlers.js";
import { getCurrentSiteId } from "../sites/context.js";

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
    ).toThrow("must contain only parsePayload and resolveSiteId");
    const accessorOptions = Object.defineProperty({}, "parsePayload", {
      enumerable: true,
      get: () => undefined,
    });
    expect(() =>
      registerJobHandler("search:accessorOptions", async () => {}, accessorOptions),
    ).toThrow("must contain only parsePayload and resolveSiteId");
    expect(() =>
      registerJobHandler("search:badSiteResolver", async () => {}, {
        resolveSiteId: "tenant-a",
      } as never),
    ).toThrow("Site id resolver");
    expect(getKnownJobTypes()).toEqual(
      expect.arrayContaining(["media:processImage", "search:deduplicate", "search:nonVoid"]),
    );
  });

  it("runs concurrent dispatches in payload-derived isolated site scopes", async () => {
    const observed = new Map<string, string[]>();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready = 0;

    const handler = async (data: { siteId: string }): Promise<void> => {
      const values = [String(await getCurrentSiteId())];
      observed.set(data.siteId, values);
      ready += 1;
      if (ready === 2) release?.();
      await gate;
      values.push(String(await getCurrentSiteId()));
    };
    const parsePayload = (data: Record<string, unknown>): { siteId: string } => {
      if (Object.keys(data).length !== 1 || typeof data.siteId !== "string") {
        throw new Error("siteId is required");
      }
      return { siteId: data.siteId };
    };
    const resolveSiteId = (data: { siteId: string }): string => data.siteId;
    registerJobHandler("search:siteScoped", handler, { parsePayload, resolveSiteId });
    expect(() =>
      registerJobHandler("search:siteScoped", handler, { parsePayload, resolveSiteId }),
    ).not.toThrow();

    await Promise.all([
      getJobHandler("search:siteScoped")?.({ siteId: "tenant-a" }),
      getJobHandler("search:siteScoped")?.({ siteId: "tenant-b" }),
    ]);

    expect(observed.get("tenant-a")).toEqual(["tenant-a", "tenant-a"]);
    expect(observed.get("tenant-b")).toEqual(["tenant-b", "tenant-b"]);
    expect(await getCurrentSiteId()).toBeNull();
  });

  it("fails before handler dispatch when the derived site id is invalid", async () => {
    const handler = vi.fn(async (_data: { siteId: string }): Promise<void> => {});
    registerJobHandler("search:invalidSite", handler, {
      parsePayload: (data) => {
        if (typeof data.siteId !== "string") throw new Error("siteId is required");
        return { siteId: data.siteId };
      },
      resolveSiteId: (data) => data.siteId,
    });

    await expect(getJobHandler("search:invalidSite")?.({ siteId: "Tenant A" })).rejects.toThrow(
      "must return a canonical site id or null",
    );
    expect(handler).not.toHaveBeenCalled();
  });
});
