import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import {
  npBuildAgentMcpConnectionPlanV1,
  type NpAgentMcpClientTransportV1,
  type NpAgentMcpClientV1,
  type NpAgentMcpConnectionConfigurationV1,
  type NpAgentMcpConnectionPackageManagerV1,
  type NpAgentMcpConnectionPlanV1,
} from "@nexpress/mcp";

export const AGENT_CONNECT_HELP = `Usage:
  nexpress agent connect --client <codex|claude> --transport stdio [--name <server>] [--apply] [--json]
  nexpress agent connect --client <codex|claude> --transport http --origin <https-origin> [--callback-port <port>]
  nexpress agent connect --client <codex|claude> --transport http --origin <https-origin> --client-id <id> [--callback-port <port>] [--apply] [--json]

Behavior:
  - Without --apply, prints an exact secret-free connection plan.
  - HTTP without --client-id prints the exact redirect URI to register in Agent Studio.
  - --apply writes only project-scoped client config and the shared NexPress SKILL.md.
  - Stdio reads NP_AGENT_SERVICE_TOKEN from the client process environment; its value is never written.
`;

export interface NpAgentConnectArgsV1 {
  help: boolean;
  apply: boolean;
  json: boolean;
  client?: NpAgentMcpClientV1;
  transport?: NpAgentMcpClientTransportV1;
  origin?: string;
  clientId?: string;
  callbackPort?: number;
  serverName?: string;
}

export interface NpAgentConnectApplyResultV1 {
  schemaVersion: "np.agent-mcp-connection-apply-result.v1";
  written: string[];
  unchanged: string[];
}

function optionValue(
  args: string[],
  index: number,
  name: string,
): { value: string; nextIndex: number } | null {
  const argument = args[index];
  if (argument === name) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return { value, nextIndex: index + 1 };
  }
  if (argument?.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value.`);
    return { value, nextIndex: index };
  }
  return null;
}

export function parseAgentConnectArgsV1(args: string[]): NpAgentConnectArgsV1 {
  const parsed: NpAgentConnectArgsV1 = { help: false, apply: false, json: false };
  const seen = new Set<string>();
  const setOnce = (name: string): void => {
    if (seen.has(name)) throw new Error(`${name} may be provided only once.`);
    seen.add(name);
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      setOnce("--help");
      parsed.help = true;
      continue;
    }
    if (argument === "--apply") {
      setOnce("--apply");
      parsed.apply = true;
      continue;
    }
    if (argument === "--json") {
      setOnce("--json");
      parsed.json = true;
      continue;
    }
    const fields = [
      ["--client", "client"],
      ["--transport", "transport"],
      ["--origin", "origin"],
      ["--client-id", "clientId"],
      ["--callback-port", "callbackPort"],
      ["--name", "serverName"],
    ] as const;
    let matched = false;
    for (const [flag, field] of fields) {
      const result = optionValue(args, index, flag);
      if (!result) continue;
      setOnce(flag);
      matched = true;
      index = result.nextIndex;
      if (field === "callbackPort") {
        if (!/^\d+$/u.test(result.value)) throw new Error("--callback-port must be an integer.");
        parsed.callbackPort = Number(result.value);
      } else if (field === "client") {
        parsed.client = result.value as NpAgentMcpClientV1;
      } else if (field === "transport") {
        parsed.transport = result.value as NpAgentMcpClientTransportV1;
      } else if (field === "origin") {
        parsed.origin = result.value;
      } else if (field === "clientId") {
        parsed.clientId = result.value;
      } else {
        parsed.serverName = result.value;
      }
      break;
    }
    if (!matched) throw new Error(`Unknown agent connect argument: ${argument ?? ""}`);
  }
  if (!parsed.help && (!parsed.client || !parsed.transport)) {
    throw new Error("agent connect requires --client and --transport.");
  }
  return parsed;
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function renderCommand(argv: readonly string[]): string {
  return argv.map(shellArgument).join(" ");
}

export function renderAgentConnectPlanV1(plan: NpAgentMcpConnectionPlanV1): string {
  const lines = [
    "# NexPress Agent Gateway connection",
    "",
    `- Client: ${plan.client}`,
    `- Transport: ${plan.transport}`,
    `- Server name: ${plan.serverName}`,
    `- Status: ${plan.status}`,
  ];
  if (plan.resource) lines.push(`- MCP resource: ${plan.resource}`);
  for (const redirect of plan.requiredRedirectUris) {
    lines.push(`- Register exact redirect URI: ${redirect}`);
  }
  if (plan.requiredEnvironmentVariables.length > 0) {
    lines.push(`- Required environment: ${plan.requiredEnvironmentVariables.join(", ")}`);
  }
  lines.push("");
  if (plan.configuration) {
    lines.push("Project files prepared by --apply:");
    lines.push(`- ${plan.configuration.relativePath}`);
    lines.push(`- ${plan.skill.relativePath}`);
    lines.push("");
    lines.push("Client configuration:");
    lines.push("```" + (plan.configuration.kind === "codex-toml" ? "toml" : "json"));
    lines.push(
      plan.configuration.kind === "codex-toml"
        ? plan.configuration.block
        : JSON.stringify({ mcpServers: { [plan.serverName]: plan.configuration.server } }, null, 2),
    );
    lines.push("```");
  } else {
    lines.push("Register the public client in Agent Studio, then rerun with --client-id <id>.");
  }
  if (plan.commands.length > 0) {
    lines.push("");
    lines.push("After configuration:");
    for (const command of plan.commands) {
      lines.push(`- ${command.purpose}: ${renderCommand(command.argv)}`);
    }
  }
  if (plan.notices.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const notice of plan.notices) lines.push(`- ${notice}`);
  }
  return `${lines.join("\n")}\n`;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function rejectSymlinkPath(cwd: string, relativePath: string): Promise<void> {
  const root = resolve(cwd);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Agent connection output escaped the project root.");
  }
  let current = root;
  for (const segment of relativePath.split("/").filter(Boolean)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Refusing to write Agent connection data through symlink ${relativePath}.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      break;
    }
  }
}

function codexNextContent(
  existing: string | null,
  configuration: Extract<NpAgentMcpConnectionConfigurationV1, { kind: "codex-toml" }>,
  serverName: string,
): { content: string; changed: boolean } {
  const source = existing ?? "";
  const start = source.indexOf(configuration.markerStart);
  const end = source.indexOf(configuration.markerEnd);
  const repeatedStart =
    start === -1
      ? -1
      : source.indexOf(configuration.markerStart, start + configuration.markerStart.length);
  const repeatedEnd =
    end === -1 ? -1 : source.indexOf(configuration.markerEnd, end + configuration.markerEnd.length);
  if (
    (start === -1) !== (end === -1) ||
    (start !== -1 && end < start) ||
    repeatedStart !== -1 ||
    repeatedEnd !== -1
  ) {
    throw new Error(`Managed Codex MCP block for ${serverName} is malformed.`);
  }
  const escaped = serverName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const unmanagedTable = new RegExp(
    `^\\s*\\[mcp_servers\\.(?:${escaped}|"${escaped}")(?:\\.|\\])`,
    "mu",
  );
  const unmanagedDotted = new RegExp(
    `^\\s*mcp_servers\\.(?:${escaped}|"${escaped}")(?:\\.|\\s*=)`,
    "mu",
  );
  const hasUnmanagedEntry = (value: string): boolean =>
    unmanagedTable.test(value) || unmanagedDotted.test(value);
  if (start !== -1) {
    const current = source.slice(start, end + configuration.markerEnd.length);
    if (current !== configuration.block) {
      throw new Error(`Managed Codex MCP server ${serverName} differs from the requested plan.`);
    }
    const remainder = `${source.slice(0, start)}${source.slice(end + configuration.markerEnd.length)}`;
    if (hasUnmanagedEntry(remainder)) {
      throw new Error(`Codex MCP server ${serverName} also exists outside the managed block.`);
    }
    return { content: source, changed: false };
  }
  if (hasUnmanagedEntry(source)) {
    throw new Error(`Codex MCP server ${serverName} already exists outside the managed block.`);
  }
  const prefix = source.length === 0 ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  return { content: `${source}${prefix}${configuration.block}\n`, changed: true };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function claudeNextContent(
  existing: string | null,
  configuration: Extract<NpAgentMcpConnectionConfigurationV1, { kind: "claude-json" }>,
  serverName: string,
): { content: string; changed: boolean } {
  let root: Record<string, unknown> = {};
  if (existing !== null) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (!isPlainRecord(parsed)) throw new Error("not-object");
      root = parsed;
    } catch {
      throw new Error("Existing .mcp.json must be one valid JSON object.");
    }
  }
  const rawServers = root.mcpServers;
  if (rawServers !== undefined && !isPlainRecord(rawServers)) {
    throw new Error("Existing .mcp.json mcpServers must be one JSON object.");
  }
  const servers = rawServers ?? {};
  const current = Object.hasOwn(servers, serverName) ? servers[serverName] : undefined;
  if (current !== undefined) {
    if (JSON.stringify(current) !== JSON.stringify(configuration.server)) {
      throw new Error(`Claude MCP server ${serverName} differs from the requested plan.`);
    }
    return { content: existing ?? "", changed: false };
  }
  root.mcpServers = { ...servers, [serverName]: configuration.server };
  return { content: `${JSON.stringify(root, null, 2)}\n`, changed: true };
}

export async function applyAgentConnectPlanV1(
  plan: NpAgentMcpConnectionPlanV1,
  cwd: string,
): Promise<NpAgentConnectApplyResultV1> {
  if (plan.status !== "ready" || !plan.configuration) {
    throw new Error("Register the OAuth public client and rerun with --client-id before --apply.");
  }
  const configPath = resolve(cwd, plan.configuration.relativePath);
  const skillPath = resolve(cwd, plan.skill.relativePath);
  await Promise.all([
    rejectSymlinkPath(cwd, plan.configuration.relativePath),
    rejectSymlinkPath(cwd, plan.skill.relativePath),
  ]);
  const [existingConfig, existingSkill] = await Promise.all([
    readOptional(configPath),
    readOptional(skillPath),
  ]);
  if (existingSkill !== null && existingSkill !== plan.skill.content) {
    throw new Error(
      `Existing ${plan.skill.relativePath} differs from the official NexPress skill.`,
    );
  }
  const next =
    plan.configuration.kind === "codex-toml"
      ? codexNextContent(existingConfig, plan.configuration, plan.serverName)
      : claudeNextContent(existingConfig, plan.configuration, plan.serverName);

  const written: string[] = [];
  const unchanged: string[] = [];
  if (existingSkill === null) {
    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, plan.skill.content, { encoding: "utf8", flag: "wx" });
    written.push(plan.skill.relativePath);
  } else {
    unchanged.push(plan.skill.relativePath);
  }
  if (next.changed) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, next.content, "utf8");
    written.push(plan.configuration.relativePath);
  } else {
    unchanged.push(plan.configuration.relativePath);
  }
  return {
    schemaVersion: "np.agent-mcp-connection-apply-result.v1",
    written: written.sort(),
    unchanged: unchanged.sort(),
  };
}

export async function runAgentConnectV1(input: {
  args: NpAgentConnectArgsV1;
  cwd: string;
  packageManager: NpAgentMcpConnectionPackageManagerV1;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  if (input.args.help) return { code: 0, stdout: AGENT_CONNECT_HELP, stderr: "" };
  try {
    const plan = npBuildAgentMcpConnectionPlanV1({
      client: input.args.client!,
      transport: input.args.transport!,
      packageManager: input.packageManager,
      ...(input.args.serverName ? { serverName: input.args.serverName } : {}),
      ...(input.args.origin ? { origin: input.args.origin } : {}),
      ...(input.args.clientId ? { clientId: input.args.clientId } : {}),
      ...(input.args.callbackPort !== undefined ? { callbackPort: input.args.callbackPort } : {}),
    });
    const applied = input.args.apply ? await applyAgentConnectPlanV1(plan, input.cwd) : null;
    if (input.args.json) {
      return {
        code: 0,
        stdout: `${JSON.stringify({ plan, applied }, null, 2)}\n`,
        stderr: "",
      };
    }
    const appliedText = applied
      ? `\nApplied:\n${applied.written.map((path) => `- wrote ${path}`).join("\n")}${
          applied.unchanged.length > 0
            ? `\n${applied.unchanged.map((path) => `- unchanged ${path}`).join("\n")}`
            : ""
        }\n`
      : "";
    return { code: 0, stdout: `${renderAgentConnectPlanV1(plan)}${appliedText}`, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 2, stdout: "", stderr: `nexpress agent connect: ${message}\n` };
  }
}
