import { describe, expect, it } from "vitest";
import { jobListUrls, jobsLocationUrl, parseJobsLocation } from "./jobs-query.js";

describe("Jobs investigation queries", () => {
  it("reads runnable buckets from live and terminal buckets from retained history", () => {
    const requests = [
      ...jobListUrls("pending", "all"),
      ...jobListUrls("active", "all"),
      ...jobListUrls("completed", "all"),
      ...jobListUrls("failed", "all"),
      ...jobListUrls("archive", "all"),
    ].map((url) => new URL(url, "https://example.test").searchParams);
    expect(requests.map((params) => [params.get("state"), params.get("source")])).toEqual([
      ["created", "live"],
      ["retry", "live"],
      ["active", "live"],
      ["completed", "archive"],
      ["failed", "archive"],
      ["cancelled", "archive"],
      ["expired", "archive"],
      ["completed", "archive"],
      ["failed", "archive"],
      ["cancelled", "archive"],
      ["expired", "archive"],
    ]);
    expect(requests.every((params) => !params.has("name") && !params.has("since"))).toBe(true);
  });

  it("preserves an exact encoded queue name and one time cutoff in every bucket request", () => {
    const queue = "custom:name&state=active + value";
    const urls = jobListUrls("failed", "24h", queue, Date.parse("2026-09-23T12:00:00Z"));
    for (const url of urls) {
      const params = new URL(url, "https://example.test").searchParams;
      expect(params.getAll("name")).toEqual([queue]);
      expect(params.getAll("state")).toHaveLength(1);
      expect(params.get("since")).toBe("2026-09-22T12:00:00.000Z");
      expect(params.get("source")).toBe("archive");
      expect(params.get("limit")).toBe("100");
    }
  });
  it("pages one state while retaining the selected queue and frozen time window", () => {
    const now = Date.parse("2026-09-24T12:00:00Z");
    const requests = [0, 100, 100_000].map((offset) => {
      const urls = jobListUrls("failed", "24h", "agent.runExecute", now, {
        state: "expired",
        offset,
      });
      expect(urls).toHaveLength(1);
      return new URL(urls[0], "https://example.test").searchParams;
    });
    expect(requests.map((params) => params.get("offset"))).toEqual(["0", "100", "100000"]);
    for (const params of requests) {
      expect(params.get("state")).toBe("expired");
      expect(params.get("source")).toBe("archive");
      expect(params.get("name")).toBe("agent.runExecute");
      expect(params.get("since")).toBe("2026-09-23T12:00:00.000Z");
    }
    expect(() =>
      jobListUrls("pending", "all", undefined, now, { state: "failed", offset: 0 }),
    ).toThrow("Invalid job page");
    for (const offset of [-1, 0.5, 100_001]) {
      expect(() =>
        jobListUrls("active", "all", undefined, now, { state: "active", offset }),
      ).toThrow("Invalid job page");
    }
  });
});

describe("Jobs investigation links", () => {
  it("restores queue, lifecycle, exact state, page and a fixed cutoff", () => {
    const location = parseJobsLocation(
      new URLSearchParams({
        name: "agent.runExecute",
        tab: "archive",
        state: "expired",
        window: "24h",
        at: "2026-09-25T12:00:00.000Z",
        offset: "100000",
      }),
    );
    expect(location).toEqual({
      queueName: "agent.runExecute",
      tab: "archive",
      state: "expired",
      windowMode: "24h",
      now: Date.parse("2026-09-25T12:00:00.000Z"),
      offset: 100000,
    });
    const restored = parseJobsLocation(
      new URL(jobsLocationUrl(location), "https://example.test").searchParams,
    );
    expect(restored).toEqual(location);
    const request = new URL(
      jobListUrls("archive", restored.windowMode, restored.queueName, restored.now, {
        state: "expired",
        offset: restored.offset,
      })[0],
      "https://example.test",
    );
    expect(request.searchParams.get("since")).toBe("2026-09-24T12:00:00.000Z");
    expect(request.searchParams.get("offset")).toBe("100000");
    expect(request.searchParams.get("source")).toBe("archive");
  });

  it("keeps default links compact and infers single-state tabs", () => {
    const initial = parseJobsLocation(new URLSearchParams());
    expect(initial).toEqual({
      queueName: undefined,
      tab: "pending",
      state: "all",
      windowMode: "all",
      offset: 0,
      now: 0,
    });
    expect(jobsLocationUrl(initial)).toBe("/admin/jobs");
    expect(parseJobsLocation(new URLSearchParams("tab=active&offset=100")).state).toBe("active");
    expect(parseJobsLocation(new URLSearchParams("tab=completed")).state).toBe("completed");
    expect(parseJobsLocation(new URLSearchParams("tab=scheduled")).state).toBe("all");
  });

  it("rejects ambiguous, incompatible and unbounded conditions instead of broadening scope", () => {
    for (const query of [
      "tab=unknown",
      "tab=constructor",
      "tab=",
      "tab=failed&tab=active",
      "name=one&name=two",
      "name=",
      "name=bad%26queue",
      "source=live",
      "tab=pending&state=failed",
      "tab=active&state=all",
      "tab=scheduled&state=active",
      "state=created&offset=-100",
      "state=created&offset=100001",
      "state=created&offset=100.0",
      "state=created&offset=0100",
      "state=created&offset=50",
      "offset=100",
      "tab=scheduled&offset=100",
      "window=day",
      "window=24h",
      "window=24h&at=nope",
      "window=24h&at=2026-09-25",
      "at=2026-09-25T12%3A00%3A00.000Z",
      "window=24h&at=2026-09-25T12%3A00%3A00.000Z&at=2026-09-25T12%3A00%3A00.000Z",
    ]) {
      expect(() => parseJobsLocation(new URLSearchParams(query)), query).toThrow();
    }
  });
});
