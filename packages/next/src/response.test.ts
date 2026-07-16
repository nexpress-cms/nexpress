import { describe, expect, it, vi } from "vitest";

import { NpError, NpForbiddenError, NpValidationError } from "@nexpress/core";
import { npRequireApiError } from "@nexpress/core/api-contract";

import { npErrorResponse, npSuccessResponse } from "./response.js";

describe("npSuccessResponse", () => {
  it("wraps the body as JSON with a 200 status by default", async () => {
    const res = npSuccessResponse({ hello: "world" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ hello: "world" });
  });

  it("honors an explicit status", () => {
    const res = npSuccessResponse({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
  });
});

describe("npErrorResponse", () => {
  it("maps an NpError to its code + status", async () => {
    const res = npErrorResponse(new NpForbiddenError("posts", "read"));
    expect(res.status).toBe(403);
    const body = npRequireApiError(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.status).toBe(403);
  });

  it("renders a generic NpError at its declared status code", async () => {
    const res = npErrorResponse(new NpError("Teapot", "IM_A_TEAPOT", 418));
    expect(res.status).toBe(418);
    const body = npRequireApiError(await res.json());
    expect(body.error.code).toBe("IM_A_TEAPOT");
  });

  it("hoists Zod-like issues into a 400 VALIDATION_ERROR", async () => {
    const res = npErrorResponse(
      new NpValidationError("bad input", [{ field: "email", message: "x" }]),
    );
    expect(res.status).toBe(400);
    const body = npRequireApiError(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeTruthy();
  });

  it("returns an opaque 500 for unknown errors", async () => {
    const res = npErrorResponse(new Error("boom"));
    expect(res.status).toBe(500);
    const body = npRequireApiError(await res.json());
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("boom");
  });

  it("normalizes Zod-like paths into the exact validation detail shape", async () => {
    const error = new Error("zod");
    Object.defineProperty(error, "issues", {
      value: [{ path: ["profile", "email"], message: "Must be an email", code: "format" }],
    });

    const response = npErrorResponse(error);
    const body = npRequireApiError(await response.json());

    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: [{ field: "profile.email", message: "Must be an email" }],
      },
      status: 400,
    });
  });

  it("does not invoke accessors in hostile Zod-like issue arrays", async () => {
    const getter = vi.fn(() => ({ path: ["secret"], message: "leak" }));
    const issues: unknown[] = [];
    Object.defineProperty(issues, "0", { enumerable: true, get: getter });
    Object.defineProperty(issues, "length", { value: 1 });
    const error = new Error("zod");
    Object.defineProperty(error, "issues", { value: issues });

    const response = npErrorResponse(error);
    const body = npRequireApiError(await response.json());

    expect(getter).not.toHaveBeenCalled();
    expect(body.error.details).toEqual([{ field: "request", message: "Invalid input" }]);
  });

  it("contains hostile error reflection traps behind the opaque boundary", async () => {
    const hostile = new Proxy(new Error("boom"), {
      get() {
        throw new Error("get trap must stay contained");
      },
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap must stay contained");
      },
      getPrototypeOf() {
        throw new Error("prototype trap must stay contained");
      },
    });

    const response = npErrorResponse(hostile);
    const body = npRequireApiError(await response.json());

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("fails closed when a known code declares the wrong status", async () => {
    const response = npErrorResponse(new NpError("Unavailable", "INTERNAL_ERROR", 503));
    const body = npRequireApiError(await response.json());

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("An unexpected error occurred");
  });

  it("preserves response headers without allowing status overrides", () => {
    const response = npErrorResponse(new NpForbiddenError("posts", "read"), {
      headers: { "Retry-After": "10" },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("Retry-After")).toBe("10");
  });
});
