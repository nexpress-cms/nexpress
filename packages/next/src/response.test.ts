import { describe, expect, it } from "vitest";

import { NxError, NxForbiddenError, NxValidationError } from "@nexpress/core";

import { nxErrorResponse, nxSuccessResponse } from "./response.js";

describe("nxSuccessResponse", () => {
  it("wraps the body as JSON with a 200 status by default", async () => {
    const res = nxSuccessResponse({ hello: "world" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ hello: "world" });
  });

  it("honors an explicit status", () => {
    const res = nxSuccessResponse({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
  });
});

describe("nxErrorResponse", () => {
  it("maps an NxError to its code + status", async () => {
    const res = nxErrorResponse(new NxForbiddenError("posts", "read"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string }; status: number };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.status).toBe(403);
  });

  it("renders a generic NxError at its declared status code", async () => {
    const res = nxErrorResponse(new NxError("Teapot", "IM_A_TEAPOT", 418));
    expect(res.status).toBe(418);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IM_A_TEAPOT");
  });

  it("hoists Zod-like issues into a 400 VALIDATION_ERROR", async () => {
    const res = nxErrorResponse(new NxValidationError("bad input", [{ field: "email", message: "x" }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details?: unknown };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeTruthy();
  });

  it("returns an opaque 500 for unknown errors", async () => {
    const res = nxErrorResponse(new Error("boom"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("boom");
  });
});
