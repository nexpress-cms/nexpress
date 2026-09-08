import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ active: false }));
vi.mock("@nexpress/core/agent-contract", () => ({
  npAgentChangeSetLimits: { previewHtmlBytes: 5 * 1024 * 1024, renderLifetimeSeconds: 120 },
}));
vi.mock("@nexpress/core/agents", () => ({
  npIsAgentChangeSetPreview: () => state.active,
  withAgentChangeSetPreview: async (_context: unknown, callback: () => Promise<unknown>) => {
    state.active = true;
    try {
      return await callback();
    } finally {
      state.active = false;
    }
  },
}));
vi.mock("@nexpress/core", () => ({
  NP_DEFAULT_SITE_ID: "default",
  getCurrentSiteId: () => Promise.resolve("default"),
  getTheme: vi.fn(() => Promise.resolve({ preview: state.active })),
  getActiveThemeId: vi.fn(() => Promise.resolve("default")),
  getThemeSettings: vi.fn(() => Promise.resolve({ preview: state.active })),
  getNavigation: vi.fn(() => Promise.resolve([{ preview: state.active }])),
  getSiteById: vi.fn(() => Promise.resolve({ preview: state.active })),
  getPluginConfig: vi.fn(() => Promise.resolve({ preview: state.active })),
  getRegisteredThemes: () => [],
  getThemeById: () => undefined,
  pluginConfigCacheTag: (id: string) => `np:plugin:${id}`,
}));
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn(() => {
    throw new Error("Preview touched shared cache");
  }),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
const { withAgentChangeSetPreviewRender } = await import("./agent-preview-render.js");
const {
  getCachedTheme,
  getCachedThemeSettings,
  getCachedNavigation,
  getCachedSite,
  getCachedPluginConfig,
  getCachedActiveThemeId,
  cachedThemeFetch,
  cachedPluginFetch,
} = await import("./cache.js");
const { unstable_cache } = await import("next/cache");
const context = {
  now: new Date(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
} as Parameters<typeof withAgentChangeSetPreviewRender>[0];
afterEach(() => vi.clearAllMocks());
describe("complete preview renderer stream", () => {
  it("consumes delayed stream reads inside the context while bypassing every public cache wrapper", async () => {
    let pulled = 0;
    const response = await withAgentChangeSetPreviewRender(context, () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              await Promise.resolve();
              expect(state.active).toBe(true);
              pulled++;
              expect(await getCachedTheme()).toEqual({ preview: true });
              expect(await getCachedThemeSettings()).toEqual({ preview: true });
              expect(await getCachedNavigation()).toEqual([{ preview: true }]);
              expect(await getCachedSite()).toEqual({ preview: true });
              expect(await getCachedPluginConfig("forum")).toEqual({ preview: true });
              expect(await getCachedActiveThemeId()).toBe("default");
              expect(await cachedThemeFetch(["preview"], () => Promise.resolve(state.active))).toBe(
                true,
              );
              expect(
                await cachedPluginFetch("forum", ["preview"], () => Promise.resolve(state.active)),
              ).toBe(true);
              controller.enqueue(new TextEncoder().encode("<html>preview</html>"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
      ),
    );
    expect(state.active).toBe(false);
    expect(pulled).toBe(1);
    expect(await response.text()).toBe("<html>preview</html>");
    expect(unstable_cache).not.toHaveBeenCalled();
  });
  it("cancels oversized output and does not accept unevaluated component values", async () => {
    const cancel = vi.fn();
    await expect(
      withAgentChangeSetPreviewRender(context, () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
              },
              cancel,
            }),
          ),
        ),
      ),
    ).rejects.toThrow("bounded limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(state.active).toBe(false);
    await expect(
      withAgentChangeSetPreviewRender(context, () =>
        Promise.resolve({ type: "div" } as unknown as Response),
      ),
    ).rejects.toThrow("Response");
  });
  it("cancels a stalled stream at the frozen render deadline", async () => {
    const cancel = vi.fn();
    const now = new Date();
    await expect(
      withAgentChangeSetPreviewRender(
        { ...context, now, expiresAt: new Date(now.getTime() + 20).toISOString() },
        () => Promise.resolve(new Response(new ReadableStream({ cancel }))),
      ),
    ).rejects.toThrow("deadline");
    expect(cancel).toHaveBeenCalledOnce();
    expect(state.active).toBe(false);
  });
});
