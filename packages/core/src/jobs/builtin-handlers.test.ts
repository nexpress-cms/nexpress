import { afterEach, describe, expect, it, vi } from "vitest";

import { configureBuiltinJobContext, registerBuiltinHandlers } from "./builtin-handlers.js";
import { getJobHandler } from "./handlers.js";
import { resetPlugins } from "../plugins/index.js";
import { getCurrentSiteId } from "../sites/context.js";
import { resetEmailAdapter, setEmailAdapter } from "../email/service.js";

afterEach(() => {
  resetEmailAdapter();
});

describe("built-in media job contract", () => {
  it("rejects malformed built-in context registration", () => {
    expect(() => configureBuiltinJobContext({ typo: vi.fn() } as never)).toThrow(
      'Unsupported built-in job context key "typo"',
    );
    expect(() => configureBuiltinJobContext({ processImage: "not-a-function" } as never)).toThrow(
      'Built-in job context "processImage" must be a function or undefined',
    );
  });

  it("validates the exact payload before dispatching the configured processor", async () => {
    const processImage = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue(undefined);
    configureBuiltinJobContext({ processImage });
    registerBuiltinHandlers();
    const handler = getJobHandler("media:processImage");
    expect(handler).toBeDefined();

    const payload = { mediaId: "bd134b0f-b9ea-4ff4-81ef-606e42e27703" };
    await handler?.(payload);
    expect(processImage).toHaveBeenCalledWith(payload);

    await expect(handler?.({ ...payload, extra: true })).rejects.toThrow(
      "job.data(media:processImage)",
    );
    await expect(handler?.({ mediaId: "not-a-uuid" })).rejects.toThrow(
      "job.data(media:processImage).mediaId",
    );
    expect(processImage).toHaveBeenCalledTimes(1);
  });

  it("fails unknown plugin schedule jobs when no legacy dispatcher exists", async () => {
    resetPlugins();
    configureBuiltinJobContext({ runScheduledPluginTask: undefined });
    registerBuiltinHandlers();

    await expect(
      getJobHandler("plugin:scheduledTask")?.({ pluginId: "missing", taskId: "daily" }),
    ).rejects.toThrow('Plugin "missing" is not registered');
  });

  it("dispatches content jobs inside the exact payload site scope", async () => {
    const resolveContentAfterSaveContext = vi.fn(async () => {
      expect(await getCurrentSiteId()).toBe("tenant-a");
      return null;
    });
    configureBuiltinJobContext({ resolveContentAfterSaveContext });
    registerBuiltinHandlers();

    await getJobHandler("content:afterSave")?.({
      siteId: "tenant-a",
      collection: "posts",
      documentId: "bd134b0f-b9ea-4ff4-81ef-606e42e27703",
      operation: "update",
      userId: "8dbb88e6-eb42-4c5d-968d-0b253fd5012f",
      memberId: null,
    });

    expect(resolveContentAfterSaveContext).toHaveBeenCalledOnce();
    expect(await getCurrentSiteId()).toBeNull();
  });

  it("builds credential email copy from the exact job expiry", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    setEmailAdapter({ kind: "capture", send });
    registerBuiltinHandlers();

    await getJobHandler("auth:sendPasswordReset")?.({
      email: "admin@example.com",
      name: "Admin",
      purpose: "invite",
      resetUrl: "https://example.com/admin/set-password?token=secret",
      expiresAt: "2026-07-20T12:30:00.000Z",
      siteName: "Example",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        text: expect.stringContaining("2026-07-20 12:30:00.000 UTC"),
      }),
    );
    await expect(
      getJobHandler("auth:sendPasswordReset")?.({
        email: "admin@example.com",
        name: "Admin",
        purpose: "invite",
        resetUrl: "https://example.com/admin/set-password?token=secret",
      }),
    ).rejects.toThrow(/expiresAt/u);
  });
});
