import { describe, expect, it } from "vitest";

import {
  npAnalyzeEmailMessage,
  npReadEmailRuntimeConfig,
  npRequireEmailAdapter,
  npRequireSmtpEmailAdapterOptions,
} from "./contract.js";

describe("email runtime contract", () => {
  it("accepts one exact message and rejects widened or injectable headers", () => {
    expect(
      npAnalyzeEmailMessage({
        to: "Alice <alice@example.com>",
        subject: "Reset your password",
        text: "Use the link.",
        html: "<p>Use the link.</p>",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeEmailMessage({
        to: "alice@example.com\r\nBcc: attacker@example.com",
        subject: "Reset",
        text: "body",
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path: "email.message.to" })]));
    expect(
      npAnalyzeEmailMessage({
        to: "alice@example.com",
        subject: "Reset",
        text: "body",
        extra: true,
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown-field" })]));
    expect(
      npAnalyzeEmailMessage({
        to: "alice@example.com",
        subject: "Reset",
        text: "\nPreserved body whitespace\n",
        html: "\n<p>Preserved body whitespace</p>\n",
      }),
    ).toEqual([]);
  });

  it("requires a canonical adapter kind and send function", () => {
    expect(
      npRequireEmailAdapter({ kind: "resend-http", send: () => Promise.resolve(undefined) }),
    ).toEqual(expect.objectContaining({ kind: "resend-http" }));
    expect(() =>
      npRequireEmailAdapter({ kind: "Resend", send: () => Promise.resolve(undefined) }),
    ).toThrow(/email\.adapter\.kind/u);
    expect(() => npRequireEmailAdapter({ kind: "custom" })).toThrow(/email\.adapter\.send/u);
  });

  it("parses one fail-closed SMTP environment contract", () => {
    expect(npReadEmailRuntimeConfig({})).toEqual({ adapter: "noop" });
    expect(npReadEmailRuntimeConfig({ NP_EMAIL_ADAPTER: "custom" })).toEqual({
      adapter: "custom",
    });
    expect(
      npReadEmailRuntimeConfig({
        NP_EMAIL_ADAPTER: "smtp",
        NP_SMTP_HOST: "smtp.example.com",
        NP_SMTP_PORT: "465",
        NP_SMTP_FROM: "NexPress <noreply@example.com>",
      }),
    ).toEqual({
      adapter: "smtp",
      options: {
        host: "smtp.example.com",
        port: 465,
        from: "NexPress <noreply@example.com>",
        secure: true,
      },
    });
    expect(() => npReadEmailRuntimeConfig({ NP_EMAIL_ADAPTER: "resend" })).toThrow(
      /NP_EMAIL_ADAPTER/u,
    );
    expect(() => npReadEmailRuntimeConfig({ NP_EMAIL_ADAPTER: "smtp" })).toThrow(/NP_SMTP_HOST/u);
    expect(() =>
      npReadEmailRuntimeConfig({
        NP_EMAIL_ADAPTER: "smtp",
        NP_SMTP_HOST: "smtp.example.com",
        NP_SMTP_PORT: "587.5",
        NP_SMTP_FROM: "noreply@example.com",
      }),
    ).toThrow(/NP_SMTP_PORT/u);
    expect(() =>
      npReadEmailRuntimeConfig({
        NP_EMAIL_ADAPTER: "smtp",
        NP_SMTP_HOST: "smtp.example.com",
        NP_SMTP_FROM: "noreply@example.com",
        NP_SMTP_SECURE: "yes",
      }),
    ).toThrow(/NP_SMTP_SECURE/u);
  });

  it("requires SMTP credentials as a pair", () => {
    expect(() =>
      npRequireSmtpEmailAdapterOptions({
        host: "smtp.example.com",
        port: 587,
        from: "noreply@example.com",
        user: "api-user",
      }),
    ).toThrow(/provided together/u);
  });

  it("rejects malformed SMTP host labels and IP literals", () => {
    for (const host of ["smtp..example.com", "-smtp.example.com", ":", "[2001:db8::1]"]) {
      expect(() =>
        npRequireSmtpEmailAdapterOptions({
          host,
          port: 587,
          from: "noreply@example.com",
        }),
      ).toThrow(/email\.smtp\.host/u);
    }
    expect(
      npRequireSmtpEmailAdapterOptions({
        host: "2001:db8::1",
        port: 587,
        from: "noreply@example.com",
      }).host,
    ).toBe("2001:db8::1");
  });
});
