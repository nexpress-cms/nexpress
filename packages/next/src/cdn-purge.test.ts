import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  getLogger: () => ({ warn: vi.fn() }),
}));

const { revalidatePath, revalidateTag } = await import("next/cache");
const { getCdnPurgeAdapter, invalidateCacheTargets, resetCdnPurgeAdapter, setCdnPurgeAdapter } =
  await import("./cdn-purge.js");

describe("CDN purge adapter registry", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    resetCdnPurgeAdapter();
  });

  it("defaults to no adapter", () => {
    expect(getCdnPurgeAdapter()).toBeNull();
  });

  it("allows callers to install and reset a purge adapter", () => {
    const adapter = { purge: vi.fn() };
    setCdnPurgeAdapter(adapter);
    expect(getCdnPurgeAdapter()).toBe(adapter);
    resetCdnPurgeAdapter();
    expect(getCdnPurgeAdapter()).toBeNull();
  });

  it("rejects adapter objects without purge()", () => {
    expect(() => setCdnPurgeAdapter({ purge: undefined as never })).toThrow(
      "setCdnPurgeAdapter: adapter must implement purge()",
    );
  });
});

describe("invalidateCacheTargets", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    resetCdnPurgeAdapter();
  });

  it("revalidates tags and paths before forwarding CDN purge hints", () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });

    invalidateCacheTargets({
      source: "site",
      siteId: "acme",
      tags: ["np:site:acme"],
      paths: [{ path: "/", type: "layout" }],
    });

    expect(revalidateTag).toHaveBeenCalledWith("np:site:acme", "default");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(purge).toHaveBeenCalledWith({
      source: "site",
      siteId: "acme",
      tags: ["np:site:acme"],
      paths: ["/"],
    });
  });

  it("dedupes path and tag hints while preserving distinct path types for Next", () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });

    invalidateCacheTargets({
      source: "theme",
      siteId: "default",
      tags: ["nx:theme:default", "nx:theme:default"],
      paths: [
        { path: "/", type: "layout" },
        { path: "/", type: "layout" },
        { path: "/", type: "page" },
      ],
    });

    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/", "page");
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(purge).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["nx:theme:default"],
        paths: ["/"],
      }),
    );
  });

  it("still forwards CDN purge hints when Next revalidation throws", () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });
    vi.mocked(revalidateTag).mockImplementationOnce(() => {
      throw new Error("static generation store missing");
    });
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("static generation store missing");
    });

    expect(() =>
      invalidateCacheTargets({
        source: "navigation",
        siteId: "default",
        navigationLocation: "header",
        tags: ["nx:nav:default:header"],
        paths: ["/"],
      }),
    ).not.toThrow();

    expect(purge).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "navigation",
        navigationLocation: "header",
        tags: ["nx:nav:default:header"],
        paths: ["/"],
      }),
    );
  });

  it("does not let CDN provider failures escape", async () => {
    setCdnPurgeAdapter({
      purge: () => Promise.reject(new Error("provider down")),
    });

    expect(() =>
      invalidateCacheTargets({
        source: "plugin-config",
        siteId: "default",
        pluginId: "forum",
        tags: ["np:plugin:forum"],
      }),
    ).not.toThrow();

    await Promise.resolve();
  });
});
