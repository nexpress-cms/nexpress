import { describe, expect, it, vi } from "vitest";

import {
  NpApiContractError,
  npAnalyzeApiError,
  npApiErrorContractLimits,
  npCreateApiError,
  npErrorStatusByCode,
  npIsApiError,
  npRequireApiError,
} from "./index.js";

describe("API error contract", () => {
  it("accepts exact known and safe extension envelopes", () => {
    expect(
      npCreateApiError("FORBIDDEN", "Access denied", 403, { capability: "admin.manage" }),
    ).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Access denied",
        details: { capability: "admin.manage" },
      },
      status: 403,
    });
    expect(npIsApiError(npCreateApiError("PLUGIN_QUOTA", "Quota exceeded", 429))).toBe(true);
  });

  it("keeps every framework code tied to one HTTP status", () => {
    for (const [code, status] of Object.entries(npErrorStatusByCode)) {
      if (code === "VALIDATION_ERROR") {
        expect(
          npCreateApiError(code, "Invalid input", status, [
            { field: "email", message: "Must be an email" },
          ]),
        ).toMatchObject({ status });
      } else {
        expect(npCreateApiError(code, "Expected failure", status)).toMatchObject({ status });
      }
    }
    expect(() => npCreateApiError("INTERNAL_ERROR", "Unavailable", 503)).toThrow(
      /must use HTTP 500/u,
    );
  });

  it("requires the canonical validation issue array", () => {
    expect(
      npCreateApiError("VALIDATION_ERROR", "Invalid input", 400, [
        { field: "profile.email", message: "Must be an email" },
      ]),
    ).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: [{ field: "profile.email", message: "Must be an email" }],
      },
      status: 400,
    });
    expect(() => npCreateApiError("VALIDATION_ERROR", "Invalid input", 400)).toThrow(
      /validation issue array/u,
    );
    expect(() =>
      npRequireApiError({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          details: [{ path: "email", message: "Wrong shape" }],
        },
        status: 400,
      }),
    ).toThrow(NpApiContractError);
  });

  it("rejects unknown envelope fields, unsafe values, and unbounded details", () => {
    expect(
      npAnalyzeApiError({
        error: { code: "NOT_FOUND", message: "Missing", extra: true },
        status: 404,
        trace: "secret",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field", path: "apiError.trace" }),
        expect.objectContaining({ code: "unknown-field", path: "apiError.error.extra" }),
      ]),
    );
    expect(() => npCreateApiError("bad-code", "Missing", 404)).toThrow(/uppercase/u);
    expect(() =>
      npCreateApiError("PLUGIN_FAILURE", "Failure", 500, {
        values: Array.from(
          { length: npApiErrorContractLimits.detailArrayItems + 1 },
          (_, index) => index,
        ),
      }),
    ).toThrow(/at most 200 entries/u);
    expect(() => npCreateApiError("PLUGIN_FAILURE", "Failure\u0000", 500)).toThrow(/safe text/u);
  });

  it("does not invoke accessors while inspecting hostile values", () => {
    const getter = vi.fn(() => "NOT_FOUND");
    const error = {};
    Object.defineProperty(error, "code", { enumerable: true, get: getter });
    Object.defineProperties(error, {
      message: { enumerable: true, value: "Missing" },
    });

    expect(npAnalyzeApiError({ error, status: 404 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "shape" })]),
    );
    expect(getter).not.toHaveBeenCalled();

    const arrayGetter = vi.fn(() => ({ field: "email", message: "Invalid" }));
    const details: unknown[] = [];
    Object.defineProperty(details, "0", { enumerable: true, get: arrayGetter });
    Object.defineProperty(details, "length", { value: 1 });
    expect(
      npAnalyzeApiError({
        error: { code: "VALIDATION_ERROR", message: "Invalid input", details },
        status: 400,
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "shape" })]));
    expect(arrayGetter).not.toHaveBeenCalled();
  });

  it("contains hostile reflection traps as contract issues", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap must stay contained");
        },
      },
    );

    expect(npAnalyzeApiError(hostile)).toEqual([
      {
        code: "unsafe-value",
        path: "apiError",
        message: "could not be inspected safely",
      },
    ]);
    expect(npIsApiError(hostile)).toBe(false);
    expect(() => npRequireApiError(hostile)).toThrow(NpApiContractError);
  });

  it("copies special JSON keys without changing object prototypes", () => {
    const details = JSON.parse('{"__proto__":{"polluted":true}}') as Record<
      string,
      { polluted: boolean }
    >;
    const result = npCreateApiError("PLUGIN_FAILURE", "Failure", 500, details);
    const parsedDetails = result.error.details as Record<string, unknown>;

    expect(Object.getPrototypeOf(parsedDetails)).toBe(Object.prototype);
    expect(Object.hasOwn(parsedDetails, "__proto__")).toBe(true);
    expect(parsedDetails.__proto__).toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
