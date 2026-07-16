import { afterEach, describe, expect, it } from "vitest";

import type { NpCollectionConfig } from "../config/types.js";
import {
  getCollectionRuntimeDiagnostics,
  npRecordCollectionRuntimeDiagnostic,
  npSerializeCollectionDocumentWithDiagnostics,
  resetCollectionRuntimeDiagnostics,
} from "./diagnostics.js";

const config: NpCollectionConfig = {
  slug: "flags",
  labels: { singular: "Flag", plural: "Flags" },
  timestamps: false,
  fields: [{ type: "checkbox", name: "enabled", required: true }],
};

afterEach(() => resetCollectionRuntimeDiagnostics());

describe("collection runtime diagnostics", () => {
  it("records failed server serialization boundaries", () => {
    expect(() =>
      npSerializeCollectionDocumentWithDiagnostics(
        {
          id: "11111111-1111-4111-8111-111111111111",
          status: "published",
          createdBy: null,
          updatedBy: null,
          visibility: "public",
          siteId: "default",
          enabled: "yes",
        },
        config,
      ),
    ).toThrow();
    expect(getCollectionRuntimeDiagnostics()).toEqual([
      expect.objectContaining({ collection: "flags", operation: "serialize" }),
    ]);
  });

  it("bounds operator-visible diagnostic messages", () => {
    npRecordCollectionRuntimeDiagnostic("flags", "read", "x".repeat(2_000));
    expect(getCollectionRuntimeDiagnostics()[0]?.message).toHaveLength(1_000);
  });
});
