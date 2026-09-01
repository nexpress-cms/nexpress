import { describe, expect, it } from "vitest";

import {
  NpAgentMcpClosedInventoryErrorV1,
  npIsAgentMcpPromptNameV1,
  npIsAgentMcpResourceTemplateUriV1,
  npIsAgentMcpResourceUriV1,
  npIsAgentMcpToolNameV1,
  npRequireAgentMcpListedInventoryV1,
} from "./closed-inventory.js";

describe("Agent MCP closed inventory", () => {
  it("accepts only framework tool and prompt names", () => {
    expect(npIsAgentMcpToolNameV1("inspect_site")).toBe(true);
    expect(npIsAgentMcpToolNameV1("revoke_sessions")).toBe(true);
    expect(npIsAgentMcpToolNameV1("plugin_publish")).toBe(false);
    expect(npIsAgentMcpPromptNameV1("nexpress_ops_triage")).toBe(true);
    expect(npIsAgentMcpPromptNameV1("plugin_prompt")).toBe(false);
  });

  it("accepts only the bounded core resource families", () => {
    expect(npIsAgentMcpResourceUriV1("nexpress://site/default/summary")).toBe(true);
    expect(
      npIsAgentMcpResourceUriV1(
        "nexpress://site/customer-a/agent-previews/preview-1/artifacts/artifact-1",
      ),
    ).toBe(true);
    expect(
      npIsAgentMcpResourceTemplateUriV1("nexpress://site/default/schema/collections/{slug}"),
    ).toBe(true);
    expect(npIsAgentMcpResourceUriV1("nexpress://site/default/plugins/custom/action")).toBe(false);
    expect(npIsAgentMcpResourceUriV1("https://evil.example/secret")).toBe(false);
  });

  it("returns one stable diagnosis without reflecting the hostile id", () => {
    let failure: unknown;
    try {
      npRequireAgentMcpListedInventoryV1("tool", [
        { name: "plugin_tool_secret-value", description: "secret-value" },
      ]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(NpAgentMcpClosedInventoryErrorV1);
    expect(failure).toMatchObject({ code: "MCP_CLOSED_INVENTORY_REJECTED", kind: "tool" });
    expect(String(failure)).not.toContain("secret-value");

    const trapped = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(): never {
          throw new Error("private-proxy-value");
        },
      },
    );
    expect(() => npRequireAgentMcpListedInventoryV1("tool", [trapped])).toThrowError(
      expect.objectContaining({ code: "MCP_CLOSED_INVENTORY_REJECTED", kind: "tool" }),
    );
  });
});
