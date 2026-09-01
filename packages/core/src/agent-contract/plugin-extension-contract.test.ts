import { describe, expect, it } from "vitest";

import {
  NpAgentPluginGatewayExtensionErrorV1,
  npAnalyzeAgentPluginGatewayExtensionsV1,
  npRequireNoAgentPluginGatewayExtensionsV1,
} from "./plugin-extension-contract.js";

describe("plugin Agent Gateway extension contract", () => {
  it("rejects every definition and manifest bypass with stable paths", () => {
    expect(
      npAnalyzeAgentPluginGatewayExtensionsV1({
        agentCapabilities: ["plugin:root"],
        manifest: {
          capabilities: ["content:read", "agent:capability"],
          agent: { mcpTools: [{ name: "secret-tool" }] },
          provides: { mcpPrompts: ["secret-prompt"] },
        },
      }),
    ).toEqual([
      {
        code: "AGENT_PLUGIN_EXTENSION_UNSUPPORTED",
        path: "plugin.agentCapabilities",
        message: "Plugin-defined Agent Gateway extensions are not supported in v1.",
      },
      {
        code: "AGENT_PLUGIN_EXTENSION_UNSUPPORTED",
        path: "plugin.manifest.agent.mcpTools",
        message: "Plugin-defined Agent Gateway extensions are not supported in v1.",
      },
      {
        code: "AGENT_PLUGIN_EXTENSION_UNSUPPORTED",
        path: "plugin.manifest.capabilities",
        message: "Plugin-defined Agent Gateway extensions are not supported in v1.",
      },
      {
        code: "AGENT_PLUGIN_EXTENSION_UNSUPPORTED",
        path: "plugin.manifest.provides.mcpPrompts",
        message: "Plugin-defined Agent Gateway extensions are not supported in v1.",
      },
    ]);
  });

  it("does not recurse into an ordinary plugin config schema", () => {
    expect(
      npAnalyzeAgentPluginGatewayExtensionsV1({
        manifest: {
          capabilities: ["content:read"],
          agent: { configSchema: { properties: { mcpTools: { type: "string" } } } },
        },
      }),
    ).toEqual([]);
  });

  it("never evaluates or reflects hostile accessors and values", () => {
    const definition = {
      manifest: {
        get agentCapabilities(): never {
          throw new Error("secret-value");
        },
      },
    };
    let failure: unknown;
    try {
      npRequireNoAgentPluginGatewayExtensionsV1(definition);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(NpAgentPluginGatewayExtensionErrorV1);
    expect(failure).toMatchObject({
      code: "AGENT_PLUGIN_EXTENSION_UNSUPPORTED",
      path: "plugin.manifest.agentCapabilities",
    });
    expect(String(failure)).not.toContain("secret-value");
  });

  it("collapses hostile proxy traps to one stable rejection", () => {
    const definition = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(): never {
          throw new Error("private-proxy-value");
        },
      },
    );
    expect(npAnalyzeAgentPluginGatewayExtensionsV1(definition)).toEqual([
      {
        code: "AGENT_PLUGIN_EXTENSION_UNSUPPORTED",
        path: "plugin",
        message: "Plugin-defined Agent Gateway extensions are not supported in v1.",
      },
    ]);
  });
});
