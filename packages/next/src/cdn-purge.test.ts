import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@nexpress/core/observability", () => ({
  getLogger: () => ({ warn: vi.fn() }),
}));

const { revalidatePath, revalidateTag } = await import("next/cache");
const {
  getCdnPurgeAdapter,
  invalidateCacheTargets,
  resetCdnPurgeAdapter,
  setCdnPurgeAdapter,
  shutdownCdnPurgeAdapter,
} = await import("./cdn-purge.js");

describe("CDN purge adapter registry", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockReset();
    vi.mocked(revalidateTag).mockReset();
    resetCdnPurgeAdapter();
  });

  it("keeps the stable setter and validates additive adapter metadata", () => {
    const adapter = { kind: "cloudflare", purge: vi.fn() };
    const replacement = { kind: "fastly", purge: vi.fn() };
    setCdnPurgeAdapter(adapter);
    expect(getCdnPurgeAdapter()).toBe(adapter);
    resetCdnPurgeAdapter(replacement);
    expect(getCdnPurgeAdapter()).toBe(adapter);
    expect(() => setCdnPurgeAdapter({ kind: "BAD", purge: vi.fn() })).toThrow();
    resetCdnPurgeAdapter();
    expect(getCdnPurgeAdapter()).toBeNull();
  });

  it("owns optional adapter shutdown and enforces a void result", async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    setCdnPurgeAdapter({ purge: vi.fn(), shutdown });
    await shutdownCdnPurgeAdapter();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(getCdnPurgeAdapter()).toBeNull();

    setCdnPurgeAdapter({
      purge: vi.fn(),
      shutdown: () => Promise.resolve("unexpected" as never),
    });
    await expect(shutdownCdnPurgeAdapter()).rejects.toThrow("must resolve to void");
    expect(getCdnPurgeAdapter()).toBeNull();
  });

  it("closes the owned adapter without detaching a replacement", async () => {
    const owned = { purge: vi.fn(), shutdown: vi.fn() };
    const replacement = { purge: vi.fn(), shutdown: vi.fn() };
    setCdnPurgeAdapter(owned);
    setCdnPurgeAdapter(replacement);

    await shutdownCdnPurgeAdapter(owned);

    expect(getCdnPurgeAdapter()).toBe(replacement);
    expect(owned.shutdown).toHaveBeenCalledOnce();
    expect(replacement.shutdown).not.toHaveBeenCalled();
  });
});

describe("invalidateCacheTargets", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockReset();
    vi.mocked(revalidateTag).mockReset();
    resetCdnPurgeAdapter();
  });

  it("awaits normalized Next and CDN work and returns an exact result", async () => {
    const purge = vi.fn().mockResolvedValue(undefined);
    setCdnPurgeAdapter({ kind: "cloudflare", purge });

    await expect(
      invalidateCacheTargets({
        source: "site",
        siteId: "acme",
        tags: ["np:site:acme", "np:site:acme"],
        paths: [
          { path: "/", type: "layout" },
          { path: "/", type: "layout" },
          { path: "/", type: "page" },
        ],
      }),
    ).resolves.toEqual({
      status: "applied",
      paths: { requested: 2, succeeded: 2, failed: 0 },
      tags: { requested: 1, succeeded: 1, failed: 0 },
      cdn: { status: "applied", adapterKind: "cloudflare" },
    });
    expect(revalidateTag).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(purge).toHaveBeenCalledWith({
      source: "site",
      siteId: "acme",
      tags: ["np:site:acme"],
      paths: ["/"],
    });
  });

  it("contains Next failures but still awaits CDN and reports partial", async () => {
    vi.mocked(revalidateTag).mockImplementationOnce(() => {
      throw new Error("static generation store missing");
    });
    const purge = vi.fn().mockResolvedValue(undefined);
    setCdnPurgeAdapter({ purge });

    await expect(
      invalidateCacheTargets({
        source: "navigation",
        siteId: "default",
        navigationLocation: "header",
        tags: ["nx:nav:default:header"],
        paths: ["/"],
      }),
    ).resolves.toMatchObject({
      status: "partial",
      tags: { failed: 1 },
      paths: { succeeded: 1 },
      cdn: { status: "applied" },
    });
    expect(purge).toHaveBeenCalledOnce();
  });

  it("contains provider rejection and reports a partial outcome", async () => {
    setCdnPurgeAdapter({
      kind: "provider",
      purge: () => Promise.reject(new Error("provider down")),
    });
    await expect(
      invalidateCacheTargets({
        source: "plugin-config",
        siteId: "default",
        pluginId: "forum",
        tags: ["np:plugin:forum"],
      }),
    ).resolves.toMatchObject({
      status: "partial",
      cdn: { status: "failed", adapterKind: "provider" },
    });
  });

  it("treats a non-void provider result as a contained purge failure", async () => {
    setCdnPurgeAdapter({
      purge: () => Promise.resolve({ purged: true } as never),
    });
    await expect(
      invalidateCacheTargets({
        source: "site",
        siteId: "default",
        tags: ["np:site:default"],
      }),
    ).resolves.toMatchObject({
      status: "partial",
      cdn: { status: "failed", adapterKind: "custom" },
    });
  });

  it("rejects malformed requests before touching Next or CDN", async () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });
    await expect(
      invalidateCacheTargets({
        source: "site",
        siteId: "default",
        tags: ["nx:sitemap:{siteId}"],
      }),
    ).rejects.toThrow("Invalid cache invalidation request");
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
  });
});
