import { EventEmitter } from "node:events";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPreviewExternalLink } from "./preview-link-check.js";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
const url = new URL("https://reviewed.example.com/path");
const authority = vi.fn(async () => {});
let status = 204;
let responseDestroyed = false;
let captured: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  status = 204;
  responseDestroyed = false;
  authority.mockResolvedValue(undefined);
  vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  vi.mocked(request).mockImplementation(((
    options: Record<string, unknown>,
    callback: (res: unknown) => void,
  ) => {
    captured = options;
    const emitter = new EventEmitter();
    Object.assign(emitter, {
      end: () =>
        callback({
          statusCode: status,
          destroy: () => {
            responseDestroyed = true;
          },
        }),
    });
    return emitter;
  }) as never);
});
describe("private preview HEAD boundary", () => {
  it("pins one DNS resolution while preserving original TLS hostname and no credentials/body", async () => {
    expect(await checkPreviewExternalLink(url, authority)).toBe("reachable");
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith(url.hostname, { all: true, verbatim: true });
    expect(captured).toMatchObject({
      protocol: "https:",
      hostname: url.hostname,
      servername: url.hostname,
      port: 443,
      method: "HEAD",
      path: "/path",
      agent: false,
      headers: {},
      maxHeaderSize: 16_384,
    });
    const callback = vi.fn();
    (captured.lookup as (...args: unknown[]) => void)(url.hostname, {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(responseDestroyed).toBe(true);
    expect(authority).toHaveBeenCalledTimes(3);
  });
  it.each([
    "4000::1",
    "3fff::1",
    "2001:20::1",
    "0.0.0.0",
    "10.1.1.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:93.184.216.34",
    "2001:db8::1",
    "2002:7f00:1::",
    "64:ff9b::7f00:1",
  ])("rejects any forbidden address in mixed DNS results: %s", async (address) => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address, family: address.includes(":") ? 6 : 4 },
    ] as never);
    expect(await checkPreviewExternalLink(url, authority)).toBe("unreachable");
    expect(request).not.toHaveBeenCalled();
  });
  it("allows globally routable IPv6 and pins that same address", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }] as never);
    expect(await checkPreviewExternalLink(url, authority)).toBe("reachable");
    const callback = vi.fn();
    (captured.lookup as (...args: unknown[]) => void)(url.hostname, {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "2606:4700:4700::1111", 6);
  });
  it.each([301, 302, 307, 308, 401, 404, 500])(
    "does not redirect or expose response content for %i",
    async (code) => {
      status = code;
      expect(await checkPreviewExternalLink(url, authority)).toBe("unreachable");
      expect(request).toHaveBeenCalledOnce();
      expect(responseDestroyed).toBe(true);
    },
  );
  it("bounds DNS stalls as well as request stalls to five seconds", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(lookup).mockImplementation(() => new Promise(() => {}) as never);
      const pending = checkPreviewExternalLink(url, authority);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toBe("timeout");
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not convert current-authority rejection into a check result", async () => {
    authority
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private authority detail"))
      .mockResolvedValue(undefined);
    await expect(checkPreviewExternalLink(url, authority)).rejects.toThrow(
      "PREVIEW_CHECK_AUTHORITY_CHANGED",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
