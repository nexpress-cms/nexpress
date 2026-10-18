import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { previewFixture } from "../agent/changeset-preview-test-fixture.js";
import { withAgentChangeSetPreview } from "../agent/changeset-preview-overlay.js";
import {
  npReadGuardianSessionFamilyV1,
  npRevokeGuardianSessionFamilyV1,
  type NpGuardianSessionFamilyRefV1,
} from "./guardian-session.js";

describe("Guardian browser family effect fence", () => {
  it("refuses revocation and locking reads before consuming inputs or a database during preview", async () => {
    const poison = new Proxy(
      {},
      {
        get() {
          throw new Error("An effect input was consumed before the preview fence");
        },
      },
    );
    const db = poison as NodePgDatabase<Record<string, unknown>>;
    const ref = poison as NpGuardianSessionFamilyRefV1;
    await withAgentChangeSetPreview(await previewFixture(), async () => {
      await expect(npRevokeGuardianSessionFamilyV1(db, ref, "invalid")).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
      await expect(npReadGuardianSessionFamilyV1(db, ref, { lock: true })).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });
  });
});
