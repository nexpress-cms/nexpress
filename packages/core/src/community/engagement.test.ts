import { describe, expect, it } from "vitest";

import { npListContentEngagement } from "./engagement.js";

const ID = "00000000-0000-4000-8000-000000000000";

describe("content engagement aggregation input", () => {
  it("validates the target type even when the requested list is empty", async () => {
    await expect(npListContentEngagement("forum-posts", [])).resolves.toEqual([]);
    await expect(npListContentEngagement("Forum posts", [])).rejects.toThrow(
      /canonical collection slug/u,
    );
  });

  it("rejects non-array and over-limit batches before reading storage", async () => {
    await expect(
      npListContentEngagement("forum-posts", "not-an-array" as unknown as string[]),
    ).rejects.toMatchObject({
      errors: [{ field: "targetIds", message: "Target ids must be an array." }],
    });
    await expect(
      npListContentEngagement(
        "forum-posts",
        Array.from({ length: 201 }, (_, index) => ID.replace(/0$/u, (index % 10).toString())),
      ),
    ).rejects.toMatchObject({
      errors: [
        {
          field: "targetIds",
          message: "At most 200 targets may be aggregated at once.",
        },
      ],
    });
  });
});
