import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getRuntime: vi.fn(), ensureFor: vi.fn(), ingest: vi.fn() }));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.getRuntime,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensureFor }));
import { handleGuardianSentryRequest } from "./guardian-sentry-http";

const url = "https://host.test/api/agents/security/sentry";
function request(body: BodyInit = '{ "action": "created" }', extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  headers.set("sentry-hook-signature", "a".repeat(64));
  headers.set("sentry-hook-resource", "issue");
  const init: RequestInit & { duplex?: "half" } = { method: "POST", headers, body };
  if (body instanceof ReadableStream) init.duplex = "half";
  return new Request(url, init);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getRuntime.mockReturnValue({ guardianSentry: { ingest: mocks.ingest } });
  mocks.ingest.mockResolvedValue({ disposition: "recorded", eventId: "private-local-id" });
});
describe("fixed Sentry callback", () => {
  it("passes original signed bytes to the explicit owner and returns no local evidence", async () => {
    const source = '{ "action": "created", "title": "untrusted" }\n';
    const result = await handleGuardianSentryRequest(request(source));
    expect(result.status).toBe(202);
    expect(await result.json()).toEqual({ received: true });
    expect(mocks.ensureFor.mock.calls).toEqual([["read"]]);
    const input = mocks.ingest.mock.calls[0][0];
    expect(new TextDecoder().decode(input.rawBody)).toBe(source);
    expect(Object.keys(input).sort()).toEqual(["rawBody", "resource", "signal", "signature"]);
    expect(input.signal).toBeInstanceOf(AbortSignal);
    mocks.getRuntime.mockReturnValue(null);
    expect((await handleGuardianSentryRequest(request())).status).toBe(404);
  });
  it("rejects browser authority, caller routing and over-limit bodies before source ingestion", async () => {
    const deniedHeaders: HeadersInit[] = [
      { cookie: "np-session=private" },
      { authorization: "Bearer private" },
      { "x-np-admin-site": "other" },
      { "content-length": "65537" },
      { "content-length": "1" },
      { "content-encoding": "gzip" },
    ];
    for (const headers of deniedHeaders)
      expect(
        (await handleGuardianSentryRequest(request("{}", headers))).status,
      ).toBeGreaterThanOrEqual(400);
    expect((await handleGuardianSentryRequest(request("x".repeat(65537)))).status).toBe(400);
    expect(
      (await handleGuardianSentryRequest(new Request(url + "?siteId=other", { method: "POST" })))
        .status,
    ).toBe(404);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("cancels a stalled stream on request abort and hides source errors", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const req = request(stream);
    const pending = handleGuardianSentryRequest(new Request(req, { signal: controller.signal }));
    controller.abort();
    expect((await pending).status).toBe(400);
    expect(mocks.ingest).not.toHaveBeenCalled();
    mocks.ingest.mockRejectedValue(new Error("private signature/provider/source body"));
    const result = await handleGuardianSentryRequest(request());
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain("private");
  });
});
