import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  npAgentHttpRoutesV1,
  npAgentInstalledCapabilityIdsV1,
} from "@nexpress/core/agent-contract";
import { buildAgentHttpOpenApiV1 } from "./openapi-agent";
vi.mock("./init-core", () => ({ ensureFor: vi.fn() }));
import { buildSpec } from "../api/openapi.json/route";

describe("Agent HTTP OpenAPI projection", () => {
  it("projects only four Agent paths with dedicated bearer security and complete exact invocation unions", () => {
    const part = buildAgentHttpOpenApiV1();
    expect(Object.keys(part.paths)).toEqual(npAgentHttpRoutesV1.map((r) => r.path));
    for (const [path, item] of Object.entries(part.paths)) {
      const operation = Object.values(item)[0] as Record<string, unknown>;
      expect(operation.security, path).toEqual([{ agentHttpServiceBearer: [] }]);
    }
    for (const name of ["NpAgentHttpInvocationRequest", "NpAgentHttpInvocationResult"]) {
      const branches = part.schemas[name].oneOf as Array<{
        properties: { capabilityId: { const: string } };
      }>;
      expect(branches.map((b) => b.properties.capabilityId.const)).toEqual(
        npAgentInstalledCapabilityIdsV1,
      );
    }
    expect(part.schemas.NpAgentHttpCapabilities).toMatchObject({
      properties: {
        capabilities: {
          maxItems: npAgentInstalledCapabilityIdsV1.length,
          items: {
            oneOf: npAgentInstalledCapabilityIdsV1.map((id) => ({
              const: expect.objectContaining({ id }),
            })),
          },
        },
      },
    });
    expect(createHash("sha256").update(JSON.stringify(part)).digest("hex")).toMatchInlineSnapshot(
      `"39bfc59065a83fa25c8361ce007c9cf70a80c8a7843e078094b2ad22c857a2d9"`,
    );
  });
  it("resolves every descriptor ref against the completed OpenAPI document", () => {
    const spec = buildSpec() as Record<string, unknown>;
    const part = buildAgentHttpOpenApiV1();
    function inspect(value: unknown): void {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref") {
          expect(typeof child).toBe("string");
          let target: unknown = spec;
          for (const segment of (child as string).slice(2).split("/"))
            target = (target as Record<string, unknown>)?.[
              segment.replace(/~1/gu, "/").replace(/~0/gu, "~")
            ];
          expect(target, child as string).toBeDefined();
        } else if (key !== "const") inspect(child);
      }
    }
    inspect(part);
    expect(
      Object.keys(spec.paths as Record<string, unknown>).filter((p) =>
        p.startsWith("/api/agent/v1/"),
      ),
    ).toEqual(npAgentHttpRoutesV1.map((r) => r.path));
    expect((spec.paths as Record<string, unknown>)["/api/mcp"]).toBeUndefined();
  });
});
