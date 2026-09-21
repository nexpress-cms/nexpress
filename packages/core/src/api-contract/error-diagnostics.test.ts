import { describe, expect, it } from "vitest";

import {
  npApiErrorDiagnosticsHeader,
  npCreateApiError,
  npIsApiError,
  npParseApiErrorDiagnosticsV1,
  type NpApiErrorDiagnosticsV1,
} from "./index.js";

const diagnostics: NpApiErrorDiagnosticsV1 = {
  version: 1,
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  supportReference: "a91c107b-9ef2-4a53-8ead-5a25b7b1a503",
  recovery: "retry-read",
};

function parse(value: unknown, expected = diagnostics) {
  return npParseApiErrorDiagnosticsV1(JSON.stringify(value), expected);
}

describe("optional API error diagnostics v1", () => {
  it("keeps diagnostics separate from the exact error envelope", () => {
    expect(npApiErrorDiagnosticsHeader).toBe("x-np-error-diagnostics");
    expect(parse(diagnostics)).toEqual(diagnostics);
    const body = npCreateApiError("SERVICE_UNAVAILABLE", "Unavailable", 503);
    expect(body).toEqual({
      error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" },
      status: 503,
    });
    expect(npIsApiError({ ...body, diagnostics })).toBe(false);
  });

  it("leaves missing, malformed and oversized headers unavailable", () => {
    for (const value of [
      null,
      "",
      "{",
      "null",
      "[]",
      "true",
      "0",
      '"provider secret"',
      " ".repeat(513),
    ]) {
      expect(npParseApiErrorDiagnosticsV1(value, diagnostics)).toBeNull();
    }
    expect(
      npParseApiErrorDiagnosticsV1(`${JSON.stringify(diagnostics)}${" ".repeat(512)}`, diagnostics),
    ).toBeNull();
  });

  it("rejects unknown versions, missing fields and any extra diagnostic payload", () => {
    expect(parse({ ...diagnostics, version: 2 })).toBeNull();
    for (const field of Object.keys(diagnostics)) {
      expect(
        parse(Object.fromEntries(Object.entries(diagnostics).filter(([key]) => key !== field))),
      ).toBeNull();
    }
    for (const field of [
      "message",
      "stack",
      "provider",
      "credential",
      "__proto__",
      "constructor",
    ]) {
      expect(parse({ ...diagnostics, [field]: "secret-provider-text" })).toBeNull();
    }
  });

  it("accepts only canonical opaque UUID v4 support references", () => {
    for (const supportReference of [
      "request-header-value",
      "vault://credentials/token",
      diagnostics.supportReference.toUpperCase(),
      diagnostics.supportReference.replace("-4a53-", "-1a53-"),
      diagnostics.supportReference.replace("-8ead-", "-7ead-"),
      ` ${diagnostics.supportReference}`,
      `${diagnostics.supportReference}\n`,
      null,
    ]) {
      expect(parse({ ...diagnostics, supportReference })).toBeNull();
    }
  });

  it("binds the metadata to both status and stable code of the response", () => {
    expect(parse(diagnostics, { ...diagnostics, status: 502 })).toBeNull();
    expect(parse(diagnostics, { ...diagnostics, code: "INTERNAL_ERROR" })).toBeNull();
    for (const [status, code] of [
      [503, "INTERNAL_ERROR"],
      [200, "CUSTOM_ERROR"],
      [600, "CUSTOM_ERROR"],
      [500.5, "CUSTOM_ERROR"],
      [503, "unsafe-provider-text"],
      [503, "A".repeat(65)],
    ] as const) {
      const invalid = { ...diagnostics, status, code, recovery: "none" as const };
      expect(parse(invalid, invalid)).toBeNull();
    }
    const extension = { ...diagnostics, code: "CUSTOM_TRANSIENT_FAILURE" };
    expect(parse(extension, extension)).toEqual(extension);
    const validation = {
      ...diagnostics,
      status: 400,
      code: "VALIDATION_ERROR",
      recovery: "none" as const,
    };
    expect(parse(validation, validation)).toEqual(validation);
  });

  it("bounds declarations to their meaningful status without inferring retryability", () => {
    const cases: [NpApiErrorDiagnosticsV1["recovery"], number[], number[]][] = [
      ["retry-read", [429, 502, 503, 504], [400, 401, 403, 409, 500]],
      ["reauthenticate", [401, 403], [400, 409, 429, 500]],
      ["reconcile", [409], [400, 401, 403, 429, 500]],
      ["check-outcome", [500, 502, 503, 504], [400, 401, 403, 409, 429]],
      ["none", [400, 401, 403, 409, 429, 500, 503], []],
    ];
    for (const [recovery, allowed, denied] of cases) {
      for (const status of allowed) {
        const value = { ...diagnostics, status, code: "CUSTOM_ERROR", recovery };
        expect(parse(value, value)).toEqual(value);
      }
      for (const status of denied) {
        const value = { ...diagnostics, status, code: "CUSTOM_ERROR", recovery };
        expect(parse(value, value)).toBeNull();
      }
    }
    expect(parse({ ...diagnostics, recovery: "retry-mutation" })).toBeNull();
    expect(parse({ ...diagnostics, recovery: true })).toBeNull();
  });
});
