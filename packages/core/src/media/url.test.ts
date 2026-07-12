import { describe, expect, it } from "vitest";

import { getMediaUrl } from "./url.js";

describe("media URL contract", () => {
  it("rejects noncanonical variant names before touching the database", async () => {
    await expect(getMediaUrl("unused", { variant: "../escape" })).rejects.toThrow(
      "Invalid media variant",
    );
    await expect(getMediaUrl("unused", { variant: "original/other" })).rejects.toThrow(
      "Invalid media variant",
    );
  });
});
