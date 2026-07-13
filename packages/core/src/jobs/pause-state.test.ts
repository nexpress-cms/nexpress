import { describe, expect, it } from "vitest";

import { setJobsPauseState } from "./pause-state.js";

describe("jobs pause runtime boundary", () => {
  it("rejects malformed inputs before database access", async () => {
    await expect(setJobsPauseState({ paused: "yes" } as never)).rejects.toThrow(
      "jobs.pause.paused",
    );
    await expect(setJobsPauseState({ paused: true, extra: true } as never)).rejects.toThrow(
      "jobs.pause.extra",
    );
    await expect(setJobsPauseState(Object.create({ paused: true }) as never)).rejects.toThrow(
      "jobs.pause input must be a plain object",
    );
  });
});
