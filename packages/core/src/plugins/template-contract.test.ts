import { describe, expect, it } from "vitest";

import { npAnalyzePageTemplateRegistry, npPageTemplateKeys } from "./template-contract.js";

describe("page template contract", () => {
  const valid = {
    pages: {
      docs: {
        label: "Documentation",
        description: "Readable docs layout.",
        component: () => null,
      },
    },
  };

  it("accepts canonical template registries and lists catalog keys", () => {
    expect(npAnalyzePageTemplateRegistry(valid)).toEqual([]);
    expect(npPageTemplateKeys(valid)).toEqual(["pages:docs"]);
  });

  it.each([
    [[], /plain object/],
    [{ "Bad Collection": { docs: valid.pages.docs } }, /lowercase kebab-case/],
    [{ pages: {} }, /non-empty plain object/],
    [{ pages: { "../docs": valid.pages.docs } }, /safe identifier/],
    [{ pages: { docs: { label: "Docs" } } }, /component must be a function/],
    [{ pages: { docs: { label: "", component: () => null } } }, /label must be non-empty/],
  ])("rejects malformed template registries", (value, message) => {
    expect(npAnalyzePageTemplateRegistry(value)[0]?.message).toMatch(message);
  });
});
