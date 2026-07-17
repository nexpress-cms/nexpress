import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  npContentTransferValidationError,
  npReadContentTransferBody,
  npReadContentTransferQuery,
} from "./content-transfer.js";

function partialTransfer(): Record<string, unknown> {
  return {
    version: "3",
    exportedAt: "2026-07-17T00:00:00.000Z",
    siteUrl: null,
    partial: true,
    collectionsExported: ["posts"],
    collections: { posts: [] },
    media: [],
  };
}

function firstValidationMessage(error: unknown): string {
  expect(error).toMatchObject({ errors: expect.any(Array) });
  return (error as { errors: Array<{ message: string }> }).errors[0]?.message ?? "";
}

describe("content transfer request boundary", () => {
  it("keeps validation diagnostics inside the public API error envelope", () => {
    const error = npContentTransferValidationError(
      "Invalid transfer",
      Array.from({ length: 101 }, (_, index) => ({
        field: `collections.${"x".repeat(300)}.${index.toString()}`,
        message: "invalid",
      })),
    );

    expect(error.errors).toHaveLength(100);
    expect(error.errors[0]?.field.length).toBeLessThanOrEqual(256);
    expect(error.errors.at(-1)?.message).toMatch(/additional validation issue/u);
  });

  it("parses exact collection and dry-run query values", () => {
    const request = new NextRequest(
      "https://example.com/api/import?collections=posts,pages&dryRun=false",
    );
    expect(npReadContentTransferQuery(request, { allowDryRun: true })).toEqual({
      collections: ["posts", "pages"],
      dryRun: false,
    });
  });

  it("rejects unknown, repeated, and noncanonical query values", () => {
    for (const [url, message] of [
      ["https://example.com/api/import?extra=true", /Unsupported query parameter/u],
      ["https://example.com/api/import?dryRun=true&dryRun=false", /exactly once/u],
      ["https://example.com/api/import?collections=posts,%20pages", /lowercase collection slug/u],
    ] as const) {
      try {
        npReadContentTransferQuery(new NextRequest(url), { allowDryRun: true });
        throw new Error("expected query validation to fail");
      } catch (error) {
        expect(firstValidationMessage(error)).toMatch(message);
      }
    }
  });

  it("reads and validates a bounded exact v3 envelope", async () => {
    const body = JSON.stringify(partialTransfer());
    const request = new NextRequest("https://example.com/api/import", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(body.length) },
      body,
    });

    await expect(npReadContentTransferBody(request)).resolves.toMatchObject({
      version: "3",
      partial: true,
    });
  });

  it("rejects wrong media type, byte count, malformed JSON, and unknown fields", async () => {
    for (const [headers, body, message] of [
      [{ "content-type": "text/plain" }, "{}", /Content-Type/u],
      [{ "content-type": "application/json", "content-length": "999" }, "{}", /does not match/u],
      [{ "content-type": "application/json" }, "{", /valid UTF-8 JSON/u],
      [
        { "content-type": "application/json" },
        JSON.stringify({ ...partialTransfer(), extra: true }),
        /Unrecognized key/u,
      ],
    ] as const) {
      try {
        await npReadContentTransferBody(
          new NextRequest("https://example.com/api/import", {
            method: "POST",
            headers,
            body,
          }),
        );
        throw new Error("expected body validation to fail");
      } catch (error) {
        expect(firstValidationMessage(error)).toMatch(message);
      }
    }
  });
});
