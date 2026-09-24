import { describe, expect, it } from "vitest";
import { jobListUrls } from "./jobs-query.js";

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
