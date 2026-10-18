import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import {
  NpAgentGuardianControlError,
  createAgentGuardianControlsV1,
  getOptionalAgentStudioServerRuntimeV1,
  type NpAgentGuardianControlsV1,
} from "@nexpress/core/agents";
import {
  npRequireAgentGuardianControlOpsResultV1,
  npRequireAgentGuardianEnablePlanV1,
  type NpAgentGuardianControlErrorCodeV1,
  type NpAgentGuardianControlOpsResultV1,
  type NpAgentGuardianEnablePlanV1,
} from "@nexpress/core/agent-contract";
import { npIsCanonicalSiteId } from "@nexpress/core/sites";
import { normalizePnpmPassthroughArgv } from "./ops-command-format.js";

export const AGENT_GUARDIAN_HELP = `NexPress Agent guardian recovery

nexpress agent guardian status --site <siteId> --json
nexpress agent guardian disable --site <siteId> --reason <text> --execute --json
nexpress agent guardian enable-plan --site <siteId> --out <artifact> --json
nexpress agent guardian enable --site <siteId> --plan <artifact> --execute --approve <planId> --json

Local deployment authority is required. Enable plans expire after five minutes.
Existing host registration and current capture-key readiness are required to enable.
Response authority remains separately gated; cleanup and historical evidence remain available.
No provider, MCP transport, worker or browser is started by these commands.
`;

export interface NpAgentGuardianCliInputV1 {
  operation: "status" | "disable" | "enable-plan" | "enable";
  siteId: string;
  reason: string | null;
  planPath: string | null;
  outPath: string | null;
  approval: string | null;
  json: boolean;
}
export function parseAgentGuardianArgsV1(args: readonly string[]): NpAgentGuardianCliInputV1 {
  const argv = normalizePnpmPassthroughArgv([...args]);
  if (argv.length > 20 || argv.some((value) => typeof value !== "string" || value.length > 4096))
    throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
  const [command, ...rest] = argv;
  if (
    command !== "status" &&
    command !== "disable" &&
    command !== "enable" &&
    command !== "enable-plan"
  )
    throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
  const fields = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!flag || fields.has(flag))
      throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
    if (["--execute", "--json", "--brief", "--no-color"].includes(flag)) fields.set(flag, true);
    else if (["--site", "--reason", "--plan", "--out", "--approve"].includes(flag)) {
      const value = rest[++i];
      if (!value || value.startsWith("--"))
        throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
      fields.set(flag, value);
    } else throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
  }
  const text = (key: string): string | null => {
    const value = fields.get(key);
    return typeof value === "string" ? value : null;
  };
  const siteId = text("--site");
  if (!npIsCanonicalSiteId(siteId))
    throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
  const execute = fields.has("--execute");
  const reason = text("--reason");
  const planPath = text("--plan");
  const outPath = text("--out");
  const approval = text("--approve");
  if (command === "status" && (execute || reason || planPath || outPath || approval))
    throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
  if (command === "disable" && (!reason || planPath || outPath || approval))
    throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
  if (command === "disable" && !execute)
    throw new NpAgentGuardianControlError("GUARDIAN_EXECUTE_REQUIRED");
  if (command === "enable-plan" && (reason || planPath || approval || execute))
    throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
  if (
    command === "enable" &&
    (reason || (planPath && outPath) || (execute && !planPath) || (!execute && approval))
  )
    throw new NpAgentGuardianControlError("GUARDIAN_ARGUMENT_INVALID");
  if (command === "enable" && planPath && !execute)
    throw new NpAgentGuardianControlError("GUARDIAN_EXECUTE_REQUIRED");
  if (command === "enable" && execute && !approval)
    throw new NpAgentGuardianControlError("GUARDIAN_APPROVAL_REQUIRED");
  return {
    operation: command === "enable" && !execute ? "enable-plan" : command,
    siteId,
    reason,
    planPath,
    outPath,
    approval,
    json: fields.has("--json"),
  };
}
async function writePlan(path: string, plan: NpAgentGuardianEnablePlanV1): Promise<void> {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
async function readPlan(path: string): Promise<NpAgentGuardianEnablePlanV1> {
  const file = await open(resolve(path), "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > 4096)
      throw new NpAgentGuardianControlError("GUARDIAN_PLAN_INVALID");
    const bytes = Buffer.alloc(4097);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = await file.read(bytes, length, bytes.byteLength - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > 4096) throw new NpAgentGuardianControlError("GUARDIAN_PLAN_INVALID");
    return npRequireAgentGuardianEnablePlanV1(
      JSON.parse(bytes.subarray(0, length).toString("utf8")) as unknown,
    );
  } finally {
    await file.close();
  }
}
export interface NpRunAgentGuardianProcessOptionsV1 {
  ensureFor: (intent: "read") => Promise<void>;
  shutdown: () => Promise<void>;
  resolveGuardianControls?: () => NpAgentGuardianControlsV1;
  env?: Readonly<Record<string, string | undefined>>;
  argv?: readonly string[];
  output?: Pick<Writable, "write">;
  readPlan?: (path: string) => Promise<NpAgentGuardianEnablePlanV1>;
  writePlan?: (path: string, plan: NpAgentGuardianEnablePlanV1) => Promise<void>;
}
/** One bootstrap owner and one bounded result; raw arguments/errors are never printed. */
export async function runAgentGuardianProcessV1(
  options: NpRunAgentGuardianProcessOptionsV1,
): Promise<number> {
  const output = options.output ?? process.stdout;
  const argv = options.argv ?? process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    output.write(AGENT_GUARDIAN_HELP);
    return 0;
  }
  let input: NpAgentGuardianCliInputV1 | null = null;
  let result: NpAgentGuardianControlOpsResultV1;
  let bootstrapAttempted = false;
  try {
    input = parseAgentGuardianArgsV1(argv);
    bootstrapAttempted = true;
    await options.ensureFor("read");
    const installedControls =
      options.resolveGuardianControls?.() ??
      getOptionalAgentStudioServerRuntimeV1()?.guardianControls;
    if (!installedControls && (input.operation === "enable-plan" || input.operation === "enable"))
      throw new NpAgentGuardianControlError("GUARDIAN_READINESS_BLOCKED");
    const controls =
      installedControls ??
      createAgentGuardianControlsV1({
        deploymentActorFingerprint: (options.env ?? process.env)
          .NP_AGENT_DEPLOYMENT_ACTOR_FINGERPRINT,
      });
    if (input.operation === "status") result = await controls.status({ siteId: input.siteId });
    else if (input.operation === "disable")
      result = await controls.disable({ siteId: input.siteId, reason: input.reason ?? "" });
    else if (input.operation === "enable-plan") {
      result = npRequireAgentGuardianControlOpsResultV1(
        await controls.prepareEnable({ siteId: input.siteId }),
      );
      if (
        result.operation !== input.operation ||
        (result.status && result.status.siteId !== input.siteId)
      )
        throw new NpAgentGuardianControlError("GUARDIAN_UNAVAILABLE");
      if (result.plan) {
        const path = input.outPath ?? `.nexpress/agent-guardian/${result.plan.id}.json`;
        try {
          await (options.writePlan ?? writePlan)(path, result.plan);
        } catch {
          throw new NpAgentGuardianControlError("GUARDIAN_ARTIFACT_UNAVAILABLE");
        }
      }
    } else {
      let plan: NpAgentGuardianEnablePlanV1;
      try {
        plan = npRequireAgentGuardianEnablePlanV1(
          await (options.readPlan ?? readPlan)(input.planPath ?? ""),
        );
        if (plan.siteId !== input.siteId || plan.id !== input.approval)
          throw new NpAgentGuardianControlError("GUARDIAN_PLAN_INVALID");
      } catch {
        throw new NpAgentGuardianControlError("GUARDIAN_PLAN_INVALID");
      }
      result = await controls.enable({
        siteId: input.siteId,
        plan,
        approval: input.approval ?? "",
      });
    }
    result = npRequireAgentGuardianControlOpsResultV1(result);
    if (
      result.operation !== input.operation ||
      (result.status && result.status.siteId !== input.siteId)
    )
      throw new NpAgentGuardianControlError("GUARDIAN_UNAVAILABLE");
  } catch (error) {
    const code: NpAgentGuardianControlErrorCodeV1 =
      error instanceof NpAgentGuardianControlError ? error.code : "GUARDIAN_UNAVAILABLE";
    result = npRequireAgentGuardianControlOpsResultV1({
      schemaVersion: "np.agent-guardian-control-ops.v1",
      operation: input?.operation ?? "status",
      outcome: "blocked",
      errorCode: code,
      status: null,
      plan: null,
    });
  } finally {
    if (bootstrapAttempted) {
      try {
        await options.shutdown();
      } catch {
        result = npRequireAgentGuardianControlOpsResultV1({
          schemaVersion: "np.agent-guardian-control-ops.v1",
          operation: input?.operation ?? "status",
          outcome: "blocked",
          errorCode: "GUARDIAN_UNAVAILABLE",
          status: null,
          plan: null,
        });
      }
    }
  }
  output.write(
    `${input?.json !== false ? JSON.stringify(result) : `Agent guardian ${result.operation}: ${result.outcome}${result.errorCode ? ` (${result.errorCode})` : ""}`}\n`,
  );
  return result.outcome === "blocked" ? 1 : 0;
}
