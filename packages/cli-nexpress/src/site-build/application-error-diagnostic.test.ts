import { describe, expect, it, vi } from "vitest";
import { projectSiteBuildApplicationErrorDiagnosticV1 } from "./application-error-diagnostic.js";

const diagnostic = {
  schemaVersion: "np.site-build-application-error-diagnostic.v1",
  reasons: [
    "connection-checkout-timeout",
    "connection-handshake-timeout",
    "statement-timeout",
    "database-cancelled",
    "connection-unavailable",
    "site-context-missing",
    "other",
  ],
  truncated: false,
};

describe("fixed application error diagnostics", () => {
  it("copies only finite categories and preserves the eight-record boundary", () => {
    const projected = projectSiteBuildApplicationErrorDiagnosticV1(diagnostic);
    expect(projected).toEqual(diagnostic);
    expect(projected?.reasons).not.toBe(diagnostic.reasons);
    expect(
      projectSiteBuildApplicationErrorDiagnosticV1({
        ...diagnostic,
        reasons: [...diagnostic.reasons, "other"],
        truncated: true,
      }),
    ).toMatchObject({ reasons: expect.any(Array), truncated: true });
  });

  it("drops raw error data and malformed records instead of projecting it", () => {
    const secret = "private-sql-url-header-value";
    for (const value of [
      { ...diagnostic, message: secret },
      { ...diagnostic, reasons: [secret] },
      { ...diagnostic, reasons: Array.from({ length: 9 }, () => "other") },
      { ...diagnostic, reasons: Object.assign(new Array<unknown>(3), { 0: "other", 2: "other" }) },
      { ...diagnostic, truncated: secret },
      { ...diagnostic, schemaVersion: secret },
      new Error(secret),
      null,
    ])
      expect(projectSiteBuildApplicationErrorDiagnosticV1(value)).toBeNull();
  });

  it("does not invoke diagnostic getters", () => {
    const get = vi.fn(() => {
      throw new Error("untrusted getter");
    });
    const value = { ...diagnostic };
    Object.defineProperty(value, "reasons", { get, enumerable: true });
    expect(projectSiteBuildApplicationErrorDiagnosticV1(value)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
