import { describe, expect, it } from "vitest";

import {
  NP_AGENT_MCP_SERVER_INSTRUCTIONS_V1,
  NP_AGENT_MCP_SKILL_MARKDOWN_V1,
  npBuildAgentMcpConnectionPlanV1,
} from "./client-connect.js";

describe("Agent MCP client connection plan", () => {
  it("renders one secret-free Codex stdio plan", () => {
    const plan = npBuildAgentMcpConnectionPlanV1({
      client: "codex",
      transport: "stdio",
      packageManager: "pnpm",
    });
    expect(plan).toMatchObject({
      schemaVersion: "np.agent-mcp-connection-plan.v1",
      status: "ready",
      requiredEnvironmentVariables: ["NP_AGENT_SERVICE_TOKEN"],
      configuration: {
        kind: "codex-toml",
        relativePath: ".codex/config.toml",
      },
      skill: { relativePath: ".agents/skills/nexpress-agent-gateway/SKILL.md" },
    });
    expect(plan.configuration).toMatchObject({
      block:
        "# nexpress-agent-connect:nexpress:start\n" +
        "[mcp_servers.nexpress]\n" +
        'command = "pnpm"\n' +
        'args = ["run","agent:mcp"]\n' +
        'env_vars = ["NP_AGENT_SERVICE_TOKEN"]\n' +
        "# nexpress-agent-connect:nexpress:end",
    });
    expect(JSON.stringify(plan)).not.toContain("npst1_");
  });

  it("renders one environment-reference-only Claude stdio plan", () => {
    const plan = npBuildAgentMcpConnectionPlanV1({
      client: "claude",
      transport: "stdio",
      packageManager: "npm",
      serverName: "nexpress_local",
    });
    expect(plan.configuration).toEqual({
      kind: "claude-json",
      relativePath: ".mcp.json",
      server: {
        type: "stdio",
        command: "npm",
        args: ["run", "agent:mcp"],
        env: { NP_AGENT_SERVICE_TOKEN: "${NP_AGENT_SERVICE_TOKEN}" },
      },
    });
    expect(plan.skill.relativePath).toBe(".claude/skills/nexpress-agent-gateway/SKILL.md");
  });

  it("provides a two-stage exact Codex HTTP registration plan", () => {
    const registration = npBuildAgentMcpConnectionPlanV1({
      client: "codex",
      transport: "http",
      packageManager: "pnpm",
      origin: "https://cms.example.test/",
      callbackPort: 43_110,
    });
    expect(registration).toMatchObject({
      status: "registration-required",
      resource: "https://cms.example.test/api/mcp",
      requiredRedirectUris: ["http://127.0.0.1:43110/callback"],
      configuration: null,
      commands: [],
    });

    const ready = npBuildAgentMcpConnectionPlanV1({
      client: "codex",
      transport: "http",
      packageManager: "pnpm",
      origin: "https://cms.example.test",
      clientId: "01900000-0000-7000-8000-000000000001",
      callbackPort: 43_110,
    });
    expect(ready).toMatchObject({
      status: "ready",
      configuration: {
        kind: "codex-toml",
        block: expect.stringContaining('callback_url = "http://127.0.0.1:43110/callback"'),
      },
      commands: [
        { purpose: "authenticate", argv: ["codex", "mcp", "login", "nexpress"] },
        { purpose: "verify", argv: ["codex", "mcp", "list"] },
        { purpose: "remove", argv: ["codex", "mcp", "remove", "nexpress"] },
      ],
    });
  });

  it("renders Claude public-client OAuth without a client secret", () => {
    const plan = npBuildAgentMcpConnectionPlanV1({
      client: "claude",
      transport: "http",
      packageManager: "yarn",
      origin: "https://cms.example.test",
      clientId: "public-client",
      callbackPort: 8_080,
    });
    expect(plan.configuration).toEqual({
      kind: "claude-json",
      relativePath: ".mcp.json",
      server: {
        type: "http",
        url: "https://cms.example.test/api/mcp",
        oauth: { clientId: "public-client", callbackPort: 8_080 },
      },
    });
    expect(plan.requiredRedirectUris).toEqual(["http://localhost:8080/callback"]);
    expect(plan.commands[0]).toEqual({ purpose: "authenticate", argv: ["claude"] });
    expect(plan.notices).toContain(
      "After Claude Code starts, run /mcp and choose nexpress to authenticate.",
    );
    expect(JSON.stringify(plan)).not.toMatch(/clientSecret|client_secret|bearer/i);
  });

  it("rejects shell, URL, callback, and credential-shaped injection", () => {
    expect(() =>
      npBuildAgentMcpConnectionPlanV1({
        client: "codex",
        transport: "stdio",
        packageManager: "pnpm",
        serverName: "nexpress\n[evil]",
      }),
    ).toThrow(/server name/u);
    expect(() =>
      npBuildAgentMcpConnectionPlanV1({
        client: "codex",
        transport: "http",
        packageManager: "pnpm",
        origin: "https://cms.example.test/path?token=secret",
      }),
    ).toThrow(/canonical HTTPS origin/u);
    expect(() =>
      npBuildAgentMcpConnectionPlanV1({
        client: "claude",
        transport: "http",
        packageManager: "pnpm",
        origin: "https://cms.example.test",
        clientId: 'client" --client-secret secret',
      }),
    ).toThrow(/client id/u);
    expect(() =>
      npBuildAgentMcpConnectionPlanV1({
        client: "claude",
        transport: "http",
        packageManager: "pnpm",
        origin: "https://cms.example.test",
        callbackPort: 80,
      }),
    ).toThrow(/callback port/u);
  });

  it("shares bounded initialization and Agent Skills-standard guidance", () => {
    expect(NP_AGENT_MCP_SERVER_INSTRUCTIONS_V1.length).toBeLessThanOrEqual(512);
    expect(NP_AGENT_MCP_SERVER_INSTRUCTIONS_V1).toContain("untrusted data");
    expect(NP_AGENT_MCP_SKILL_MARKDOWN_V1).toMatch(
      /^---\nname: nexpress-agent-gateway\ndescription:/u,
    );
    expect(NP_AGENT_MCP_SKILL_MARKDOWN_V1).toContain("Never call an unadvertised tool");
    expect(NP_AGENT_MCP_SKILL_MARKDOWN_V1).not.toContain("npst1_");
  });
});
