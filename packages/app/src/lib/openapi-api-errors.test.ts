import { describe, expect, it } from "vitest";

import {
  npApiErrorOpenApiResponses,
  npApplyApiErrorOpenApiResponses,
  npCreateApiErrorOpenApiSchemas,
} from "./openapi-api-errors.js";

describe("OpenAPI API error contracts", () => {
  it("publishes the bounded envelope and known code/status mapping", () => {
    const schemas = npCreateApiErrorOpenApiSchemas();
    const errorResponse = schemas.error_response as {
      additionalProperties?: boolean;
      allOf?: unknown[];
      properties?: { status?: { minimum?: number; maximum?: number } };
    };

    expect(errorResponse.additionalProperties).toBe(false);
    expect(errorResponse.properties?.status).toEqual({
      type: "integer",
      minimum: 400,
      maximum: 599,
    });
    expect(errorResponse.allOf?.length).toBeGreaterThan(10);
    expect(npApiErrorOpenApiResponses.api_error).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/error_response" },
        },
      },
    });
  });

  it("attaches the canonical schema to every declared and fallback error response", () => {
    const paths = npApplyApiErrorOpenApiResponses({
      "/api/example": {
        parameters: [],
        get: {
          responses: {
            "200": { description: "ok" },
            "404": { description: "missing" },
          },
        },
      },
    });
    const operation = paths["/api/example"]?.get as {
      responses: Record<string, { $ref?: string; content?: Record<string, unknown> }>;
    };

    expect(operation.responses["200"]?.content).toBeUndefined();
    expect(operation.responses["404"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/error_response" } },
    });
    expect(operation.responses.default?.$ref).toBe("#/components/responses/api_error");
  });
});
