import { afterEach, describe, expect, it, vi } from "vitest";

import {
  npGetCollectionMutationObserverV1,
  resetCollectionMutationObserverV1,
  setCollectionMutationObserverV1,
} from "./mutation-observer.js";

vi.mock("../db/runtime.js", () => ({
  getDb: () => {
    throw new Error("The observer registry must not initialize or read a database");
  },
}));

afterEach(resetCollectionMutationObserverV1);

describe("optional collection mutation receipt owner", () => {
  it("stays absent without database initialization and rejects a malformed owner", () => {
    expect(npGetCollectionMutationObserverV1()).toBeNull();
    for (const value of [null, {}, { record: true }])
      expect(() => Reflect.apply(setCollectionMutationObserverV1, undefined, [value])).toThrow(
        "Invalid collection mutation observer",
      );
    expect(npGetCollectionMutationObserverV1()).toBeNull();
  });

  it("preserves a mutation's captured owner when host installation changes", () => {
    const original = { record: vi.fn(() => Promise.resolve()) };
    const replacement = { record: vi.fn(() => Promise.resolve()) };
    setCollectionMutationObserverV1(original);
    const captured = npGetCollectionMutationObserverV1();
    setCollectionMutationObserverV1(replacement);
    expect(captured).toBe(original);
    expect(npGetCollectionMutationObserverV1()).toBe(replacement);
    resetCollectionMutationObserverV1();
    expect(npGetCollectionMutationObserverV1()).toBeNull();
    expect(captured).toBe(original);
    expect(original.record).not.toHaveBeenCalled();
    expect(replacement.record).not.toHaveBeenCalled();
  });
});
