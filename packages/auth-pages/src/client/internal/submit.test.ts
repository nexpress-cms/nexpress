import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AUTH_MESSAGES } from "../../shared/types.js";
import { resolveMessages, submitJson } from "./submit.js";

describe("resolveMessages", () => {
  it("returns defaults when no override given", () => {
    expect(resolveMessages()).toBe(DEFAULT_AUTH_MESSAGES);
  });

  it("merges partial override on top of defaults", () => {
    const out = resolveMessages({ NETWORK: "오프라인입니다." });
    expect(out.NETWORK).toBe("오프라인입니다.");
    // Untouched codes stay default.
    expect(out.INVALID_CREDENTIALS).toBe(DEFAULT_AUTH_MESSAGES.INVALID_CREDENTIALS);
  });
});

describe("submitJson", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok with parsed payload on 2xx", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ member: { id: "x" } }),
    });
    const result = await submitJson<{ member: { id: string } }>(
      "/api/test",
      {},
      DEFAULT_AUTH_MESSAGES,
    );
    expect(result).toEqual({ ok: true, data: { member: { id: "x" } } });
  });

  it("maps AUTH error code → INVALID_CREDENTIALS", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: { code: "AUTH", message: "Invalid credentials" },
        }),
    });
    const result = await submitJson("/api/test", {}, DEFAULT_AUTH_MESSAGES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CREDENTIALS");
      expect(result.message).toBe(DEFAULT_AUTH_MESSAGES.INVALID_CREDENTIALS);
    }
  });

  it("extracts per-field validation errors from `error.details`", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: {
            code: "VALIDATION",
            message: "Invalid input",
            details: [
              { field: "email", message: "Valid email required" },
              { field: "password", message: "Password must be at least 8 characters" },
            ],
          },
        }),
    });
    const result = await submitJson("/api/test", {}, DEFAULT_AUTH_MESSAGES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.fields).toEqual({
        email: "Valid email required",
        password: "Password must be at least 8 characters",
      });
    }
  });

  it("returns NETWORK on fetch throw", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
    const result = await submitJson("/api/test", {}, DEFAULT_AUTH_MESSAGES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NETWORK");
      expect(result.message).toBe(DEFAULT_AUTH_MESSAGES.NETWORK);
    }
  });

  it("uses caller's message override for the matched code", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
    const messages = resolveMessages({ NETWORK: "오프라인입니다." });
    const result = await submitJson("/api/test", {}, messages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NETWORK");
      expect(result.message).toBe("오프라인입니다.");
    }
  });
});
