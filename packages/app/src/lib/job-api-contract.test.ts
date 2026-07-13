import { describe, expect, it } from "vitest";

import {
  npParseEnqueueJobBody,
  npParseEmptyJobBody,
  npParseEmptyJobQuery,
  npParseJobId,
  npParseJobListQuery,
  npParseJobLogsQuery,
  npParsePauseJobBody,
  npParseRetryAllQuery,
  npRequireJobApiResponse,
} from "./job-api-contract.js";

describe("Admin jobs API inputs", () => {
  it("parses exact list filters without fail-open fallbacks", () => {
    expect(
      npParseJobListQuery(
        new URLSearchParams(
          "state=failed&source=archive&limit=20&offset=10&since=2026-07-13T00%3A00%3A00.000Z",
        ),
      ),
    ).toEqual({
      state: "failed",
      source: "archive",
      limit: 20,
      offset: 10,
      since: new Date("2026-07-13T00:00:00.000Z"),
    });
    expect(() => npParseJobListQuery(new URLSearchParams("state=unknown"))).toThrow(
      /Invalid input/u,
    );
    expect(() => npParseJobListQuery(new URLSearchParams("limit=2oops"))).toThrow(/Invalid input/u);
    expect(() => npParseJobListQuery(new URLSearchParams("limit=0"))).toThrow(/Invalid input/u);
    expect(() => npParseJobListQuery(new URLSearchParams("name=not+a+queue"))).toThrow(
      /Invalid input/u,
    );
    expect(() => npParseJobListQuery(new URLSearchParams("source=live&source=archive"))).toThrow(
      /Invalid input/u,
    );
  });

  it("rejects unsupported log and retry filters", () => {
    expect(npParseJobLogsQuery(new URLSearchParams("limit=500&offset=0"))).toEqual({
      limit: 500,
      offset: 0,
    });
    expect(() => npParseJobLogsQuery(new URLSearchParams("limit=-1"))).toThrow(/Invalid input/u);
    expect(() => npParseJobLogsQuery(new URLSearchParams("limit=0"))).toThrow(/Invalid input/u);
    expect(() => npParseRetryAllQuery(new URLSearchParams("state=retry"))).toThrow(
      /Invalid input/u,
    );
  });

  it("requires exact enqueue and pause bodies", () => {
    expect(npParseEnqueueJobBody({ type: "search:reindex", data: { scope: "all" } })).toEqual({
      type: "search:reindex",
      data: { scope: "all" },
    });
    expect(() => npParseEnqueueJobBody({ type: "search:reindex", data: {}, extra: true })).toThrow(
      /Invalid input/u,
    );
    expect(() => npParseEnqueueJobBody({ type: "not-canonical", data: {} })).toThrow(
      /Invalid input/u,
    );
    expect(() =>
      npParseEnqueueJobBody({ type: "search:reindex", data: { bad: undefined } }),
    ).toThrow(/Invalid input/u);
    expect(npParseJobId("job-1")).toBe("job-1");
    expect(() => npParseJobId("")).toThrow(/Invalid input/u);
    expect(npParsePauseJobBody({ reason: "maintenance" })).toEqual({
      reason: "maintenance",
    });
    expect(() => npParsePauseJobBody({ reason: 42 })).toThrow(/Invalid input/u);
    expect(npParseEmptyJobBody({})).toBeUndefined();
    expect(() => npParseEmptyJobBody({ extra: true })).toThrow(/Invalid input/u);
    expect(() => npParseEmptyJobQuery(new URLSearchParams("extra=true"))).toThrow(/Invalid input/u);

    const inherited = Object.create({ type: "search:reindex" }) as Record<string, unknown>;
    inherited.data = {};
    expect(() => npParseEnqueueJobBody(inherited)).toThrow(/Invalid input/u);

    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "reason", { enumerable: true, get: () => "maintenance" });
    expect(() => npParsePauseJobBody(accessor)).toThrow(/Invalid input/u);
  });

  it("turns server response corruption into an internal contract error", () => {
    expect(() =>
      npRequireJobApiResponse({ ok: false }, () => {
        throw new Error("missing id");
      }),
    ).toThrow("Job API response contract violation: missing id");
  });
});
