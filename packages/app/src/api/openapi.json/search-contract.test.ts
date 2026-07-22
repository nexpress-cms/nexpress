import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI search contract", () => {
  it("documents the public audience invariant without changing the response envelope", () => {
    const spec = buildSpec() as {
      paths: Record<
        string,
        {
          get: {
            description: string;
            responses: Record<
              string,
              {
                content: {
                  "application/json": {
                    schema: {
                      properties: {
                        results: {
                          items: {
                            properties: {
                              doc: {
                                required: string[];
                                properties: Record<string, Record<string, unknown>>;
                              };
                            };
                          };
                        };
                      };
                    };
                  };
                };
              }
            >;
          };
        }
      >;
    };

    const operation = spec.paths["/api/search"]?.get;
    expect(operation?.description).toContain('audience="public"');
    const document =
      operation?.responses["200"]?.content["application/json"].schema.properties.results.items
        .properties.doc;
    expect(document?.required).toEqual(["id", "siteId", "status", "visibility"]);
    expect(document?.properties.audience).toMatchObject({ const: "public" });
  });
});
