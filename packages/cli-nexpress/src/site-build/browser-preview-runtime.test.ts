import { describe, expect, it, vi } from "vitest";
import { runSiteBuildBrowserPreviewChecksV1 } from "./browser-preview-runtime.js";

const context = {
  themePackage: "@nexpress/theme-default",
  origin: "http://127.0.0.1:18080",
  route: "/",
  locale: "ko",
  headerNavigation: "present" as const,
  metadata: {
    owner: "page" as const,
    canonicalPath: "/",
    descriptionRequired: true,
    structuredData: "optional" as const,
  },
};
const common = {
  schemaVersion: "np.site-build-browser-preview-observation.v1",
  themePackage: context.themePackage,
  route: "/",
  locale: "ko",
  metadataOwner: "page",
  routeMatches: true,
};
const document = {
  ...common,
  phase: "document",
  complete: true,
  metadata: { missing: false, invalid: false },
  accessibility: [],
  overflow: { root: false, controls: false },
  links: [],
};
const interaction = { ...common, phase: "interaction", supported: true, passed: true };

describe("fixed isolated-world preview runtime", () => {
  it("creates its own nonprivileged world, runs fixed bounded probes then settles", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ executionContextId: 7 })
      .mockResolvedValueOnce({ result: { type: "object", value: document } })
      .mockResolvedValueOnce({ result: { type: "object", value: interaction } });
    const settle = vi.fn().mockResolvedValue(undefined);
    expect(
      await runSiteBuildBrowserPreviewChecksV1({ command, frameId: "FRAME_1", context, settle }),
    ).toEqual({ document, interaction });
    expect(command.mock.calls[0]).toEqual([
      "Page.createIsolatedWorld",
      {
        frameId: "FRAME_1",
        worldName: "np-site-build-preview-checks-v1",
        grantUniveralAccess: false,
      },
    ]);
    for (const [method, params] of command.mock.calls.slice(1)) {
      expect(method).toBe("Runtime.evaluate");
      expect(params).toMatchObject({
        contextId: 7,
        awaitPromise: true,
        returnByValue: true,
        timeout: 5000,
      });
      expect(params.expression).not.toContain("document.cookie");
    }
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.invocationCallOrder[0]).toBeGreaterThan(command.mock.invocationCallOrder[2]);
  });
  it("rejects hostile expectations and failed execution without leaking exception text or continuing", async () => {
    const command = vi.fn();
    const settle = vi.fn();
    await expect(
      runSiteBuildBrowserPreviewChecksV1({
        command,
        frameId: "FRAME",
        context: { ...context, origin: "https://external.invalid" },
        settle,
      }),
    ).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
    command.mockResolvedValueOnce({ executionContextId: 2 }).mockResolvedValueOnce({
      exceptionDetails: {
        text: "synthetic-private-dom-error",
      },
    });
    await expect(
      runSiteBuildBrowserPreviewChecksV1({ command, frameId: "FRAME", context, settle }),
    ).rejects.toMatchObject({ message: "input" });
    expect(command).toHaveBeenCalledTimes(2);
    expect(settle).not.toHaveBeenCalled();
  });
});
