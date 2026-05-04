import { describe, expect, it, vi } from "vitest";

import {
  downloadMedia,
  isAllowedMimeType,
  resolveEnvDownloadOptions,
  WpMediaDownloadError,
  WpMediaSsrfError,
} from "./download.js";

function makeFetchOnce(
  body: Uint8Array,
  init: ResponseInit & { url?: string } = {},
): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(body, init))) as unknown as typeof fetch;
}

// All non-SSRF tests pretend the source host resolves to a public
// IP. The `dnsLookupImpl` injection is the cheapest way to keep
// the test suite hermetic without touching real DNS.
const publicDns = vi.fn(() => Promise.resolve([{ address: "93.184.216.34", family: 4 }]));

describe("downloadMedia", () => {
  it("returns the body, mime, and inferred filename for a 200 response", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
    const out = await downloadMedia(
      "https://example.com/wp-content/uploads/2025/04/hero.jpg",
      { fetchImpl, retries: 0, dnsLookupImpl: publicDns },
    );
    expect(Array.from(out.buffer)).toEqual([1, 2, 3]);
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.filename).toBe("hero.jpg");
  });

  it("strips charset suffixes from content-type", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array([0]), {
      status: 200,
      headers: { "content-type": "image/png; charset=binary" },
    });
    const out = await downloadMedia("https://example.com/x.png", {
      fetchImpl,
      retries: 0,
      dnsLookupImpl: publicDns,
    });
    expect(out.mimeType).toBe("image/png");
  });

  it("throws WpMediaDownloadError with status on 404 — no retry", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("", { status: 404 }))) as unknown as typeof fetch;
    await expect(
      downloadMedia("https://example.com/missing.jpg", {
        fetchImpl,
        retries: 2,
        dnsLookupImpl: publicDns,
      }),
    ).rejects.toMatchObject({ name: "WpMediaDownloadError", status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once on transient failure then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve(
        new Response(new Uint8Array([9]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    }) as unknown as typeof fetch;
    const out = await downloadMedia("https://example.com/h.jpg", {
      fetchImpl,
      retries: 1,
      dnsLookupImpl: publicDns,
    });
    expect(out.mimeType).toBe("image/jpeg");
    expect(calls).toBe(2);
  });

  it("falls back to octet-stream when content-type is missing", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array([0]), { status: 200 });
    const out = await downloadMedia("https://example.com/file.bin", {
      fetchImpl,
      retries: 0,
      dnsLookupImpl: publicDns,
    });
    expect(out.mimeType).toBe("application/octet-stream");
  });

  it("decodes URL-encoded filenames", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array([0]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
    const out = await downloadMedia(
      "https://example.com/path/hello%20world.jpg",
      { fetchImpl, retries: 0, dnsLookupImpl: publicDns },
    );
    expect(out.filename).toBe("hello world.jpg");
  });

  it("throws after exhausting retries on persistent failure", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("network"))) as unknown as typeof fetch;
    await expect(
      downloadMedia("https://example.com/x.jpg", {
        fetchImpl,
        retries: 2,
        dnsLookupImpl: publicDns,
      }),
    ).rejects.toBeInstanceOf(WpMediaDownloadError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("downloadMedia — SSRF guard (#270)", () => {
  it("rejects non-http schemes immediately", async () => {
    const fetchImpl = vi.fn();
    await expect(
      downloadMedia("file:///etc/passwd", { fetchImpl, retries: 0 }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects literal localhost", async () => {
    const fetchImpl = vi.fn();
    await expect(
      downloadMedia("http://localhost/wp-content/x.jpg", { fetchImpl, retries: 0 }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects loopback IPv4 literal", async () => {
    const fetchImpl = vi.fn();
    await expect(
      downloadMedia("http://127.0.0.1/x.jpg", { fetchImpl, retries: 0 }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects RFC1918 ranges (10/8, 192.168/16, 172.16/12)", async () => {
    const fetchImpl = vi.fn();
    for (const ip of ["10.0.0.5", "192.168.1.1", "172.20.0.1"]) {
      await expect(
        downloadMedia(`http://${ip}/x.jpg`, { fetchImpl, retries: 0 }),
      ).rejects.toBeInstanceOf(WpMediaSsrfError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects link-local and AWS metadata 169.254.169.254", async () => {
    const fetchImpl = vi.fn();
    await expect(
      downloadMedia("http://169.254.169.254/latest/meta-data/", { fetchImpl, retries: 0 }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects IPv6 loopback ::1", async () => {
    const fetchImpl = vi.fn();
    await expect(
      downloadMedia("http://[::1]/x.jpg", { fetchImpl, retries: 0 }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects IPv6 ULA fc00::/7 and link-local fe80::/10", async () => {
    const fetchImpl = vi.fn();
    for (const ip of ["fc00::1", "fd12:3456::1", "fe80::1"]) {
      await expect(
        downloadMedia(`http://[${ip}]/x.jpg`, { fetchImpl, retries: 0 }),
      ).rejects.toBeInstanceOf(WpMediaSsrfError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects when DNS resolves to a private IP", async () => {
    const fetchImpl = vi.fn();
    const privateDns = vi.fn(() => Promise.resolve([{ address: "10.0.0.5", family: 4 }]));
    await expect(
      downloadMedia("https://internal.example.com/x.jpg", {
        fetchImpl,
        retries: 0,
        dnsLookupImpl: privateDns,
      }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects when ANY of multiple resolved addresses is private", async () => {
    const fetchImpl = vi.fn();
    const mixedDns = vi.fn(() =>
      Promise.resolve([
        { address: "93.184.216.34", family: 4 }, // public
        { address: "10.0.0.5", family: 4 }, // private — should still reject
      ]),
    );
    await expect(
      downloadMedia("https://multihomed.example.com/x.jpg", {
        fetchImpl,
        retries: 0,
        dnsLookupImpl: mixedDns,
      }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does NOT retry SSRF rejections — deterministic", async () => {
    const fetchImpl = vi.fn();
    const privateDns = vi.fn(() => Promise.resolve([{ address: "127.0.0.1", family: 4 }]));
    await expect(
      downloadMedia("https://loop.example.com/x.jpg", {
        fetchImpl,
        retries: 5,
        dnsLookupImpl: privateDns,
      }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    expect(privateDns).toHaveBeenCalledTimes(1);
  });

  it("escape hatch: allowPrivateHosts skips the DNS check entirely", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array([7]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    const out = await downloadMedia("http://127.0.0.1/x.png", {
      fetchImpl,
      retries: 0,
      allowPrivateHosts: true,
    });
    expect(out.mimeType).toBe("image/png");
  });
});

describe("downloadMedia — manual redirect handling (#270)", () => {
  it("follows a 302 redirect to a public host", async () => {
    let calls = 0;
    const fetchImpl = vi.fn((_url: string) => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(
          new Response("", {
            status: 302,
            headers: { location: "https://cdn.example.com/asset.jpg" },
          }),
        );
      }
      return Promise.resolve(
        new Response(new Uint8Array([4, 2]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    }) as unknown as typeof fetch;
    const out = await downloadMedia("https://example.com/r.jpg", {
      fetchImpl,
      retries: 0,
      dnsLookupImpl: publicDns,
    });
    expect(Array.from(out.buffer)).toEqual([4, 2]);
    // Filename comes from the original URL, not the CDN hop.
    expect(out.filename).toBe("r.jpg");
    expect(calls).toBe(2);
  });

  it("re-validates the host on every redirect hop — blocks redirect to private IP", async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url.includes("public")) {
        return Promise.resolve(
          new Response("", {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 200 }));
    }) as unknown as typeof fetch;
    await expect(
      downloadMedia("https://public.example.com/r.jpg", {
        fetchImpl,
        retries: 0,
        dnsLookupImpl: publicDns,
      }),
    ).rejects.toBeInstanceOf(WpMediaSsrfError);
    // First fetch happens, second is blocked before fetch runs.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caps redirects at maxRedirects", async () => {
    let n = 0;
    const fetchImpl = vi.fn(() => {
      n++;
      return Promise.resolve(
        new Response("", {
          status: 302,
          headers: { location: `https://example.com/hop${n}.jpg` },
        }),
      );
    }) as unknown as typeof fetch;
    await expect(
      downloadMedia("https://example.com/start.jpg", {
        fetchImpl,
        retries: 0,
        maxRedirects: 2,
        dnsLookupImpl: publicDns,
      }),
    ).rejects.toBeInstanceOf(WpMediaDownloadError);
    // Initial + 2 redirects = 3 fetch calls before we give up.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects redirect with no Location header", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array(), { status: 302 });
    await expect(
      downloadMedia("https://example.com/x.jpg", {
        fetchImpl,
        retries: 0,
        dnsLookupImpl: publicDns,
      }),
    ).rejects.toMatchObject({ name: "WpMediaDownloadError", status: 302 });
  });
});

describe("downloadMedia — content-length cap (#270)", () => {
  it("rejects when content-length exceeds maxBytes — without reading body", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([0]), {
          status: 200,
          headers: { "content-type": "image/jpeg", "content-length": "999999999" },
        }),
      ),
    ) as unknown as typeof fetch;
    await expect(
      downloadMedia("https://example.com/huge.jpg", {
        fetchImpl,
        retries: 0,
        maxBytes: 1024,
        dnsLookupImpl: publicDns,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("content-length") });
  });

  it("rejects when actual body exceeds maxBytes (no content-length header)", async () => {
    const big = new Uint8Array(2048);
    const fetchImpl = makeFetchOnce(big, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
    await expect(
      downloadMedia("https://example.com/x.jpg", {
        fetchImpl,
        retries: 0,
        maxBytes: 1024,
        dnsLookupImpl: publicDns,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("exceeds maxBytes") });
  });
});

describe("resolveEnvDownloadOptions (#270)", () => {
  it("returns an empty object when no env vars are set", () => {
    expect(resolveEnvDownloadOptions({})).toEqual({});
  });

  it("sets allowPrivateHosts when NX_WP_IMPORT_ALLOW_PRIVATE_HOSTS=1", () => {
    expect(
      resolveEnvDownloadOptions({ NX_WP_IMPORT_ALLOW_PRIVATE_HOSTS: "1" }),
    ).toEqual({ allowPrivateHosts: true });
  });

  it("also accepts NX_WP_IMPORT_ALLOW_PRIVATE_HOSTS=true", () => {
    expect(
      resolveEnvDownloadOptions({ NX_WP_IMPORT_ALLOW_PRIVATE_HOSTS: "true" }),
    ).toEqual({ allowPrivateHosts: true });
  });

  it("ignores other truthy-ish values — only \"1\" or \"true\" count", () => {
    for (const v of ["yes", "on", "TRUE", "y", "0"]) {
      expect(
        resolveEnvDownloadOptions({ NX_WP_IMPORT_ALLOW_PRIVATE_HOSTS: v }).allowPrivateHosts,
      ).toBeUndefined();
    }
  });

  it("parses NX_WP_IMPORT_MAX_BYTES as a positive integer", () => {
    expect(
      resolveEnvDownloadOptions({ NX_WP_IMPORT_MAX_BYTES: "536870912" }),
    ).toEqual({ maxBytes: 536870912 });
  });

  it("ignores non-numeric / non-positive maxBytes silently", () => {
    for (const v of ["", "abc", "0", "-1"]) {
      const out = resolveEnvDownloadOptions({ NX_WP_IMPORT_MAX_BYTES: v });
      expect(out.maxBytes).toBeUndefined();
    }
  });

  it("combines both knobs when both are set", () => {
    expect(
      resolveEnvDownloadOptions({
        NX_WP_IMPORT_ALLOW_PRIVATE_HOSTS: "1",
        NX_WP_IMPORT_MAX_BYTES: "1024",
      }),
    ).toEqual({ allowPrivateHosts: true, maxBytes: 1024 });
  });
});

describe("downloadMedia — DNS pinning (#382)", () => {
  it("attaches an undici Agent dispatcher when the preflight DNS check passes", async () => {
    // Whatever init.dispatcher fetch receives must be a non-null
    // undici Agent — that is the connect-time pin that closes the
    // rebinding window between assertHostAllowed and fetch.
    let capturedDispatcher: unknown = null;
    const fetchImpl = vi.fn((_url: string, init?: unknown) => {
      capturedDispatcher = (init as { dispatcher?: unknown })?.dispatcher ?? null;
      return Promise.resolve(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    }) as unknown as typeof fetch;

    const dnsLookupImpl = vi.fn(() =>
      Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    );
    await downloadMedia("https://example.com/x.jpg", {
      fetchImpl,
      retries: 0,
      dnsLookupImpl,
    });

    expect(capturedDispatcher).not.toBeNull();
    expect(capturedDispatcher).toHaveProperty("dispatch");
  });

  it("rejects a hostname that resolves to no usable address", async () => {
    const fetchImpl = vi.fn();
    const emptyDns = vi.fn(() => Promise.resolve([]));
    await expect(
      downloadMedia("https://example.com/x.jpg", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retries: 0,
        dnsLookupImpl: emptyDns,
      }),
    ).rejects.toThrow(WpMediaSsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips the dispatcher when allowPrivateHosts is set", async () => {
    let capturedDispatcher: unknown = "unset";
    const fetchImpl = vi.fn((_url: string, init?: unknown) => {
      capturedDispatcher = (init as { dispatcher?: unknown })?.dispatcher ?? null;
      return Promise.resolve(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    }) as unknown as typeof fetch;

    await downloadMedia("http://10.0.0.1/x.jpg", {
      fetchImpl,
      retries: 0,
      allowPrivateHosts: true,
    });
    expect(capturedDispatcher).toBeNull();
  });
});

describe("isAllowedMimeType", () => {
  it("allows image/*, video/*, and application/pdf", () => {
    expect(isAllowedMimeType("image/jpeg")).toBe(true);
    expect(isAllowedMimeType("image/svg+xml")).toBe(true);
    expect(isAllowedMimeType("video/mp4")).toBe(true);
    expect(isAllowedMimeType("application/pdf")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("application/octet-stream")).toBe(false);
    expect(isAllowedMimeType("application/zip")).toBe(false);
  });
});
