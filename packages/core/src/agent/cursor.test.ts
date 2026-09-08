import { describe, expect, it } from "vitest";
import { createAgentCursorCodecV1 } from "./cursor.js";

describe("Agent opaque cursor inventory isolation", () => {
  it("round trips bounded values while concealing row and authority data", () => {
    const codec = createAgentCursorCodecV1(new Uint8Array(32).fill(1), "np.agent-changeset.cursor");
    const value = {
      binding: "opaque-authority-binding",
      expires: 1900000000000,
      position: { id: "11111111-1111-4111-8111-111111111111", time: "2026-09-08T00:00:00.000Z" },
    };
    const first = codec.seal(value),
      second = codec.seal(value);
    expect(codec.open(first)).toEqual(value);
    expect(first).not.toBe(second);
    expect(first).not.toContain(value.position.id);
    expect(first.length).toBeLessThan(2048);
  });
  it("rejects tampering, wrong inventory, wrong key and malformed envelopes", () => {
    const key = new Uint8Array(32).fill(2);
    const codec = createAgentCursorCodecV1(key, "np.agent-changeset.cursor");
    const cursor = codec.seal({ binding: "fixture", position: null });
    expect(() => createAgentCursorCodecV1(key, "np.agent-activity.cursor").open(cursor)).toThrow();
    expect(() =>
      createAgentCursorCodecV1(new Uint8Array(32).fill(3), "np.agent-changeset.cursor").open(
        cursor,
      ),
    ).toThrow();
    const altered = (cursor[0] === "A" ? "B" : "A") + cursor.slice(1);
    for (const value of ["", altered, cursor + ".extra", cursor.slice(0, -1), "x".repeat(2049)])
      expect(() => codec.open(value)).toThrow();
  });
  it("snapshots the input key so later caller mutation cannot change cursor authority", () => {
    const key = new Uint8Array(32).fill(4);
    const codec = createAgentCursorCodecV1(key, "changesets");
    const cursor = codec.seal({ binding: "fixture" });
    const signature = codec.mac("fixture");
    key.fill(5);
    expect(codec.open(cursor)).toEqual({ binding: "fixture" });
    expect(codec.mac("fixture")).toBe(signature);
  });
});
