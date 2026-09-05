import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../packages/core/src/agent/read-capability-executors.ts";

// Cross-package regression: reuse the transport's installed SDK validator
// without introducing a Core dependency on the transport or its SDK.
const requireMcp = createRequire(new URL("../packages/mcp/package.json", import.meta.url));
const { AjvJsonSchemaValidator } = requireMcp("@modelcontextprotocol/sdk/validation/ajv");

describe("Agent block schema projection", () => {
  it("accepts advertised block shapes while rejecting unknown properties and types", async () => {
    const executors = createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "schema-test", key: new Uint8Array(32).fill(19) },
      resolveUser: () => ({
        id: "01900000-0000-7000-8000-000000000010",
        email: "schema@example.test",
        name: "Schema test",
        role: "editor",
        tokenVersion: 1,
      }),
      resolveBlockSchemas: () =>
        ["hero", "heading"].map((type) => ({
          type,
          schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: type },
              props: {
                type: "object",
                additionalProperties: false,
                properties: { text: { type: "string", maxLength: 100 } },
                required: ["text"],
              },
            },
            required: ["type", "props"],
          },
        })),
    });
    const output = await executors["schema.get"](
      { selector: "blocks" },
      {
        siteId: "default",
        principal: {
          kind: "service",
          siteId: "default",
          principalId: "01900000-0000-7000-8000-000000000011",
          authority: { kind: "user", userId: "01900000-0000-7000-8000-000000000010" },
          credentialId: "01900000-0000-7000-8000-000000000012",
          gatewayExposureCeiling: "read",
          scopes: ["schema:read"],
        },
        requestedAt: "2026-09-01T00:00:00.000Z",
        invocationId: "01900000-0000-7000-8000-000000000013",
        idempotencyKey: null,
        abortSignal: new AbortController().signal,
      },
    );
    const validate = new AjvJsonSchemaValidator().getValidator(output.schema);
    for (const type of ["hero", "heading"]) {
      assert.equal(validate({ type, props: { text: "Visible" } }).valid, true);
      assert.equal(validate({ type, props: { text: "Visible", extra: true } }).valid, false);
      assert.equal(validate({ type, props: { text: "Visible" }, extra: true }).valid, false);
    }
    assert.equal(validate({ type: "unknown", props: { text: "Visible" } }).valid, false);
    assert.equal(validate({}).valid, false);
  });
});
