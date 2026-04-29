import { describe, expect, it, vi } from "vitest";

import { downloadMedia, isAllowedMimeType, WpMediaDownloadError } from "./download.js";

function makeFetchOnce(
  body: Uint8Array,
  init: ResponseInit & { url?: string } = {},
): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(body, init))) as unknown as typeof fetch;
}

describe("downloadMedia", () => {
  it("returns the body, mime, and inferred filename for a 200 response", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
    const out = await downloadMedia(
      "https://example.com/wp-content/uploads/2025/04/hero.jpg",
      { fetchImpl, retries: 0 },
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
    const out = await downloadMedia("https://example.com/x.png", { fetchImpl, retries: 0 });
    expect(out.mimeType).toBe("image/png");
  });

  it("throws WpMediaDownloadError with status on 404 — no retry", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("", { status: 404 }))) as unknown as typeof fetch;
    await expect(
      downloadMedia("https://example.com/missing.jpg", { fetchImpl, retries: 2 }),
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
    const out = await downloadMedia("https://example.com/h.jpg", { fetchImpl, retries: 1 });
    expect(out.mimeType).toBe("image/jpeg");
    expect(calls).toBe(2);
  });

  it("falls back to octet-stream when content-type is missing", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array([0]), { status: 200 });
    const out = await downloadMedia("https://example.com/file.bin", { fetchImpl, retries: 0 });
    expect(out.mimeType).toBe("application/octet-stream");
  });

  it("decodes URL-encoded filenames", async () => {
    const fetchImpl = makeFetchOnce(new Uint8Array([0]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
    const out = await downloadMedia(
      "https://example.com/path/hello%20world.jpg",
      { fetchImpl, retries: 0 },
    );
    expect(out.filename).toBe("hello world.jpg");
  });

  it("throws after exhausting retries on persistent failure", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("network"))) as unknown as typeof fetch;
    await expect(
      downloadMedia("https://example.com/x.jpg", { fetchImpl, retries: 2 }),
    ).rejects.toBeInstanceOf(WpMediaDownloadError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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
