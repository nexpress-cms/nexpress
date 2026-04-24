import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns ok + timestamp", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; timestamp: number };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("number");
  });
});
