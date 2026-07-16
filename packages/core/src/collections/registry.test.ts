import { afterEach, describe, expect, it } from "vitest";

import { NpCollectionContractError } from "../collection-contract/contract.js";
import type { NpCollectionConfig } from "../config/types.js";
import { getCollectionRegistration, registerCollection, resetCollections } from "./registry.js";

const config: NpCollectionConfig = {
  slug: "articles",
  labels: { singular: "Article", plural: "Articles" },
  fields: [
    {
      type: "array",
      name: "credits",
      fields: [{ type: "text", name: "name", required: true }],
    },
    {
      type: "relationship",
      name: "tags",
      relationTo: "tags",
      hasMany: true,
    },
  ],
};

afterEach(() => resetCollections());

describe("collection related-table registration contract", () => {
  it("fails before startup when a declared array or hasMany table is missing", () => {
    expect(() => registerCollection("articles", {}, config)).toThrow(NpCollectionContractError);
  });

  it("rejects stale related tables that are no longer declared", () => {
    expect(() =>
      registerCollection("articles", {}, config, {
        childTables: { credits: {}, legacy: {} },
        joinTables: { tags: {} },
      }),
    ).toThrow(NpCollectionContractError);
  });

  it("retains the exact related-table inventory", () => {
    const credits = {};
    const tags = {};
    registerCollection("articles", {}, config, {
      childTables: { credits },
      joinTables: { tags },
    });
    expect(getCollectionRegistration("articles")).toMatchObject({
      childTables: { credits },
      joinTables: { tags },
    });
  });
});
