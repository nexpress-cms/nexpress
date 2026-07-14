import { describe, expect, it } from "vitest";

import { buildInviteEmail, buildMemberVerifyEmail, buildResetEmail } from "./templates.js";

const baseData = {
  siteName: "Acme",
  name: "Alice",
  resetUrl: "https://acme.example.com/admin/set-password?token=abc123",
  expiresAt: "2026-07-20T12:30:00.000Z",
};

describe("buildInviteEmail", () => {
  it("produces a subject that references the site name", () => {
    const out = buildInviteEmail(baseData);
    expect(out.subject).toContain("Acme");
  });

  it("inlines the reset URL + recipient name in both text and html", () => {
    const out = buildInviteEmail(baseData);
    expect(out.text).toContain(baseData.resetUrl);
    expect(out.text).toContain("Alice");
    expect(out.html).toContain(baseData.resetUrl);
    expect(out.html).toContain("Alice");
  });

  it("renders the exact issued expiry instead of a hard-coded duration", () => {
    const out = buildInviteEmail(baseData);
    expect(out.text).toContain("2026-07-20 12:30:00.000 UTC");
    expect(out.html).toContain("2026-07-20 12:30:00.000 UTC");
  });
});

describe("buildResetEmail", () => {
  it("produces a subject distinct from the invite variant", () => {
    const invite = buildInviteEmail(baseData);
    const reset = buildResetEmail(baseData);
    expect(reset.subject).not.toBe(invite.subject);
    expect(reset.subject).toMatch(/reset/i);
  });

  it("renders the exact issued expiry", () => {
    const out = buildResetEmail(baseData);
    expect(out.text).toContain("2026-07-20 12:30:00.000 UTC");
    expect(out.html).toContain("2026-07-20 12:30:00.000 UTC");
  });

  it("rejects a non-canonical credential expiry", () => {
    expect(() => buildResetEmail({ ...baseData, expiresAt: "2026-07-20T12:30:00Z" })).toThrow(
      /expiresAt/u,
    );
  });
});

describe("buildMemberVerifyEmail", () => {
  it("renders the exact verification expiry", () => {
    const out = buildMemberVerifyEmail({
      siteName: "Acme",
      displayName: "Alice",
      verifyUrl: "https://acme.example.com/members/verify?token=abc123",
      expiresAt: "2026-07-15T09:45:00.000Z",
    });
    expect(out.text).toContain("2026-07-15 09:45:00.000 UTC");
    expect(out.html).toContain("2026-07-15 09:45:00.000 UTC");
  });
});

describe("escaping", () => {
  it("escapes <script> in siteName and name in the html body", () => {
    const out = buildInviteEmail({
      siteName: "<script>alert(1)</script>",
      name: "Ev & Bob",
      resetUrl: "https://example.com/x",
      expiresAt: baseData.expiresAt,
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("Ev &amp; Bob");
  });

  it("escapes quotes inside the href attribute", () => {
    const out = buildInviteEmail({
      ...baseData,
      resetUrl: `https://example.com/"><svg onload=alert(1)>`,
    });
    // The raw `"><svg ...` payload must be escaped in the anchor attr
    // so it can't break out of the href quotes.
    expect(out.html).not.toContain(`"><svg onload=alert(1)>`);
    expect(out.html).toContain("&quot;");
  });
});
