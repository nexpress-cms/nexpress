import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  activate: vi.fn(),
  view: vi.fn(),
  bootstrap: vi.fn(),
  consume: vi.fn(),
  renderPreview: vi.fn(),
  renderer: vi.fn(),
  staff: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.runtime,
}));
vi.mock("@nexpress/core/sites", async (original) => ({
  ...(await original<object>()),
  withCurrentSite: (_site: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock("@nexpress/next", async (original) => ({
  ...(await original<object>()),
  withAgentChangeSetPreviewRender: (_context: unknown, callback: () => Promise<Response>) =>
    callback(),
}));
vi.mock("./studio-admin", () => ({
  requireAgentOauthStaff: mocks.staff,
  normalizeAgentStudioError: (error: unknown) => error,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensure }));
import { handleAgentPreviewOriginRequest, handleAgentPreviewRenderRequest } from "./preview-http";
import type { NpAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
const id = "10000000-0000-4000-8000-000000000001";
const previewOrigin = "https://preview.example.net";
const renderOrigin = "https://127.0.0.1:39281";
function runtime() {
  return {
    previewAccess: {
      previewOrigin,
      activate: mocks.activate,
      view: mocks.view,
      bootstrapRender: mocks.bootstrap,
      consumeCapture: mocks.consume,
    },
    changesets: { renderPreview: mocks.renderPreview },
    previewRenderer: mocks.renderer,
  } as unknown as NpAgentStudioServerRuntimeV1;
}
function request(path: string, init: RequestInit = {}, origin = previewOrigin) {
  return new Request(`${origin}${path}`, {
    ...init,
    headers: { host: new URL(origin).host, ...init.headers },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.runtime.mockReturnValue(runtime());
  mocks.activate.mockResolvedValue({
    html: "<p>activated</p>",
    headers: { "cache-control": "private, no-store", "set-cookie": "preview-cookie" },
  });
  mocks.view.mockImplementation(({ render }) =>
    render({
      db: {},
      preview: { siteId: "default", id },
      route: "/",
      locale: null,
      viewer: { userId: id, sessionId: id },
    }),
  );
  mocks.renderPreview.mockImplementation(({ render }) => render({}));
  mocks.renderer.mockResolvedValue(
    new Response("<h1>Preview</h1>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "unsafe=1",
        location: "https://external.example.com",
        "cache-control": "public,max-age=3600",
      },
    }),
  );
  mocks.bootstrap.mockResolvedValue({ cookie: "render-cookie" });
  mocks.consume.mockResolvedValue({
    preview: { siteId: "default", id },
    capture: { route: "/", locale: null },
  });
});
describe("isolated preview request inventory", () => {
  it("fails closed for absent runtime and every production/API path", async () => {
    for (const path of [
      "/",
      "/admin",
      "/api/admin/users",
      "/api/agent/v1/capabilities",
      "/__np/launch?exchange=secret",
      `/__np/view/${id}/${id}/%2F?siteId=other`,
    ])
      expect((await handleAgentPreviewOriginRequest(request(path))).status).toBe(404);
    mocks.runtime.mockReturnValue(null);
    expect(
      (await handleAgentPreviewOriginRequest(request("/__np/launch", { method: "POST" }))).status,
    ).toBe(404);
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("rejects Host, purpose crossover, wrong method and duplicate form fields before activation", async () => {
    for (const init of [
      { method: "GET" },
      { method: "POST", headers: { host: "site.example.com" } },
      { method: "POST", headers: { "x-np-preview-render": "token" } },
      { method: "POST", headers: { authorization: "Bearer token" } },
      {
        method: "POST",
        headers: {
          origin: "https://site.example.com",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "exchange=a&exchange=b",
      },
      {
        method: "POST",
        headers: {
          origin: "https://site.example.com",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "exchange=a&other=b",
      },
    ] as RequestInit[])
      expect((await handleAgentPreviewOriginRequest(request("/__np/launch", init))).status).toBe(
        404,
      );
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("passes only the exact exchange and production Origin to shared access", async () => {
    const response = await handleAgentPreviewOriginRequest(
      request("/__np/launch", {
        method: "POST",
        headers: {
          origin: "https://site.example.com",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "exchange=opaque",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.activate).toHaveBeenCalledWith({
      exchange: "opaque",
      origin: "https://site.example.com",
    });
    expect(response.headers.get("set-cookie")).toBe("preview-cookie");
  });
  it("uses shared viewer authority, exact route encoding, and framework-only headers", async () => {
    const response = await handleAgentPreviewOriginRequest(
      request(`/__np/view/${id}/${id}/%2F`, { headers: { cookie: "preview=value" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>Preview</h1>");
    expect(mocks.view).toHaveBeenCalledWith(
      expect.objectContaining({
        previewId: id,
        launchId: id,
        encodedRoute: "%2F",
        cookie: "preview=value",
      }),
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(mocks.renderPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        viewer: { userId: id, sessionId: id },
        route: { route: "/", locale: null, audience: "public" },
      }),
    );
  });
  it("serves only exact injected immutable assets without forwarding request credentials", async () => {
    const load = vi.fn(() =>
      Promise.resolve(
        new Response("h1{color:red}", {
          headers: { "content-type": "text/css; charset=utf-8", "set-cookie": "unsafe=1" },
        }),
      ),
    );
    const options = { immutableAssets: { "/__np/assets/fixture.css": load } };
    const response = await handleAgentPreviewOriginRequest(
      request("/__np/assets/fixture.css", { headers: { cookie: "private=credential" } }),
      options,
    );
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const head = await handleAgentPreviewOriginRequest(
      request("/__np/assets/fixture.css", { method: "HEAD" }),
      options,
    );
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe("13");
    for (const path of [
      "/__np/assets/missing.css",
      "/__np/assets/fixture.css?q=1",
      "/__np/assets/%66ixture.css",
    ])
      expect((await handleAgentPreviewOriginRequest(request(path), options)).status).toBe(404);
    expect(
      (
        await handleAgentPreviewOriginRequest(
          request("/__np/assets/fixture.css", { method: "POST" }),
          options,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleAgentPreviewOriginRequest(request("/__np/assets/fixture.css"), {
          immutableAssets: {
            "/__np/assets/fixture.css": () =>
              Promise.resolve(new Response("<html>", { headers: { "content-type": "text/html" } })),
          },
        })
      ).status,
    ).toBe(404);
  });
  it.each(["loader", "stream"])(
    "bounds a stalled asset %s and cancels late output",
    async (mode) => {
      vi.useFakeTimers();
      try {
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({ cancel }), {
          headers: { "content-type": "text/css" },
        });
        let finish: ((response: Response) => void) | undefined;
        const load = () =>
          mode === "stream"
            ? Promise.resolve(response)
            : new Promise<Response>((resolve) => {
                finish = resolve;
              });
        const pending = handleAgentPreviewOriginRequest(request("/__np/assets/fixture.css"), {
          immutableAssets: { "/__np/assets/fixture.css": load },
        });
        await vi.advanceTimersByTimeAsync(120000);
        expect((await pending).status).toBe(404);
        finish?.(response);
        await Promise.resolve();
        await Promise.resolve();
        expect(cancel).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("clears only the path-scoped preview cookie after denial, without leaking errors", async () => {
    mocks.view.mockRejectedValue(new Error("private internal locator"));
    const response = await handleAgentPreviewOriginRequest(request(`/__np/view/${id}/${id}/%2F`));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(response.headers.get("set-cookie")).toContain(`Path=/__np/view/${id}/; Max-Age=0;`);
  });
});
describe("ephemeral render request boundary", () => {
  const path = `/__np/preview/render-route/${id}/1`;
  const metadata = {
    "sec-fetch-site": "none",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    "x-np-preview-capture": "ticket",
    cookie: "render=value",
  };
  it("accepts bootstrap only through its dedicated header and exact route", async () => {
    const result = await handleAgentPreviewRenderRequest(
      request(
        "/__np/preview/render-bootstrap",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-np-preview-render": "token" },
          body: "{}",
        },
        renderOrigin,
      ),
      { origin: renderOrigin, runtime: runtime() },
    );
    expect(result.status).toBe(204);
    expect(mocks.bootstrap).toHaveBeenCalledWith({
      token: "token",
      origin: renderOrigin,
      body: {},
    });
    const rejected = await handleAgentPreviewRenderRequest(
      request(
        "/__np/preview/render-bootstrap",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-np-preview-render": "token",
            cookie: "np-session=staff",
          },
          body: "{}",
        },
        renderOrigin,
      ),
      { origin: renderOrigin, runtime: runtime() },
    );
    expect(rejected.status).toBe(404);
  });
  it("rejects every non-document/subresource request without consuming a ticket", async () => {
    for (const headers of [
      { ...metadata, "sec-fetch-site": "cross-site" },
      { ...metadata, "sec-fetch-mode": "cors" },
      { ...metadata, "sec-fetch-dest": "image" },
      { ...metadata, "x-np-preview-render": "token" },
      {},
    ])
      expect(
        (
          await handleAgentPreviewRenderRequest(request(path, { headers }, renderOrigin), {
            origin: renderOrigin,
            runtime: runtime(),
          })
        ).status,
      ).toBe(404);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("consumes only one exact ordinal before rendering and never forwards ticket credentials", async () => {
    expect(
      (
        await handleAgentPreviewRenderRequest(request(path, { headers: metadata }, renderOrigin), {
          origin: renderOrigin,
          runtime: runtime(),
        })
      ).status,
    ).toBe(200);
    expect(mocks.consume).toHaveBeenCalledWith({
      renderSessionId: id,
      ordinal: 1,
      cookie: "render=value",
      ticket: "ticket",
    });
    expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.renderer.mock.invocationCallOrder[0],
    );
    expect(mocks.renderer).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ nonce: expect.any(String) }),
    );
  });
});
