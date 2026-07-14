import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoopEmailAdapter } from "./noop.js";
import { getEmailAdapter, resetEmailAdapter, sendEmail, setEmailAdapter } from "./service.js";

describe("NoopEmailAdapter", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("resolves successfully and logs the message", async () => {
    const adapter = new NoopEmailAdapter();
    await adapter.send({
      to: "alice@example.com",
      subject: "Hi",
      text: "body line 1\nbody line 2",
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    const firstArg = warnSpy.mock.calls[0]?.[0];
    const logged = typeof firstArg === "string" ? firstArg : "";
    expect(logged).toContain("alice@example.com");
    expect(logged).toContain("Hi");
    expect(logged).toContain("body line 1");
  });

  it("declares its kind", () => {
    expect(new NoopEmailAdapter().kind).toBe("noop");
  });
});

describe("email adapter singleton", () => {
  afterEach(() => {
    resetEmailAdapter();
  });

  it("defaults to a NoopEmailAdapter", () => {
    expect(getEmailAdapter()).toBeInstanceOf(NoopEmailAdapter);
  });

  it("setEmailAdapter replaces the singleton", () => {
    const custom = {
      kind: "custom",
      send: vi.fn().mockResolvedValue(undefined),
    };
    setEmailAdapter(custom);
    expect(getEmailAdapter()).toBe(custom);
  });

  it("validates messages and requires adapters to resolve to void", async () => {
    setEmailAdapter({
      kind: "bad-result",
      send: vi.fn().mockResolvedValue({ providerId: "leaked-result" }) as never,
    });
    await expect(
      sendEmail({ to: "alice@example.com", subject: "Hi", text: "body" }),
    ).rejects.toThrow(/resolve to void/u);
    await expect(
      sendEmail({ to: "alice@example.com\r\nBcc: bad@example.com", subject: "Hi", text: "body" }),
    ).rejects.toThrow(/email\.message\.to/u);
  });

  it("resetEmailAdapter restores the noop default", () => {
    setEmailAdapter({ kind: "custom", send: async () => {} });
    resetEmailAdapter();
    expect(getEmailAdapter()).toBeInstanceOf(NoopEmailAdapter);
  });
});
