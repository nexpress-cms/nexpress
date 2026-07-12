import { npSettings } from "@nexpress/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { POST } from "@/app/api/admin/patterns/route";

describe.skipIf(skipIfNoTestDb())("page pattern settings contract (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects out-of-contract pattern metadata before persistence", async () => {
    const session = await seedUser({ role: "admin" });
    const response = await POST(
      buildRequest("/api/admin/patterns", {
        method: "POST",
        session,
        body: { id: "x".repeat(161), label: "Example", blocks: [] },
      }),
    );

    expect(response.status).toBe(400);
    const db = await getTestDb();
    expect(
      (await db.select().from(npSettings)).filter((row) => row.key === "page-builder.patterns"),
    ).toHaveLength(0);
  });
});
