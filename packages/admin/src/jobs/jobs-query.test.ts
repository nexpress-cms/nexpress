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
});
