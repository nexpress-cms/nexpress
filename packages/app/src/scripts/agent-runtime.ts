import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import {
  NpAgentRuntimeControlError,
  createAgentRuntimeControlsV1,
  getOptionalAgentStudioServerRuntimeV1,
  type NpAgentRuntimeControlsV1,
} from "@nexpress/core/agents";
import {
  npRequireAgentRuntimeOpsResultV1,
  npRequireAgentRuntimeResumePlanV1,
  type NpAgentRuntimeOpsErrorCodeV1,
  type NpAgentRuntimeOpsResultV1,
  type NpAgentRuntimeResumePlanV1,
} from "@nexpress/core/agent-contract";
import { npIsCanonicalSiteId } from "@nexpress/core/sites";
import { normalizePnpmPassthroughArgv } from "./ops-command-format.js";

export const AGENT_RUNTIME_HELP = `NexPress Agent runtime recovery

nexpress agent runtime status --site <siteId> --json
nexpress agent runtime pause --site <siteId> --reason <text> --execute --json
nexpress agent runtime resume --site <siteId> --out <artifact> --json
nexpress agent runtime resume --site <siteId> --plan <artifact> --execute --approve <planId> --json

Local deployment authority is required. Resume plans expire after five minutes.
No provider, MCP transport, worker or browser is started by these commands.
`;

export interface NpAgentRuntimeCliInputV1 {
  operation: "status" | "pause" | "resume-plan" | "resume";
  siteId: string;
  reason: string | null;
  planPath: string | null;
  outPath: string | null;
  approval: string | null;
  json: boolean;
}
export function parseAgentRuntimeArgsV1(args: readonly string[]): NpAgentRuntimeCliInputV1 {
  const argv = normalizePnpmPassthroughArgv([...args]);
  if (argv.length > 20 || argv.some((value) => typeof value !== "string" || value.length > 4096))
    throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
  const [command, ...rest] = argv;
  if (command !== "status" && command !== "pause" && command !== "resume")
    throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
  const fields = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!flag || fields.has(flag)) throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
    if (["--execute", "--json", "--brief", "--no-color"].includes(flag)) fields.set(flag, true);
    else if (["--site", "--reason", "--plan", "--out", "--approve"].includes(flag)) {
      const value = rest[++i];
      if (!value || value.startsWith("--"))
        throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
      fields.set(flag, value);
    } else throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
  }
  const text = (key: string): string | null => {
    const value = fields.get(key);
    return typeof value === "string" ? value : null;
  };
  const siteId = text("--site");
  if (!npIsCanonicalSiteId(siteId))
    throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
  const execute = fields.has("--execute");
  const reason = text("--reason");
  const planPath = text("--plan");
  const outPath = text("--out");
  const approval = text("--approve");
  if (command === "status" && (execute || reason || planPath || outPath || approval))
    throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
  if (command === "pause" && (!reason || planPath || outPath || approval))
    throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
  if (command === "pause" && !execute)
    throw new NpAgentRuntimeControlError("RUNTIME_EXECUTE_REQUIRED");
  if (
    command === "resume" &&
    (reason || (planPath && outPath) || (execute && !planPath) || (!execute && approval))
  )
    throw new NpAgentRuntimeControlError("RUNTIME_ARGUMENT_INVALID");
  if (command === "resume" && planPath && !execute)
    throw new NpAgentRuntimeControlError("RUNTIME_EXECUTE_REQUIRED");
  if (command === "resume" && execute && !approval)
    throw new NpAgentRuntimeControlError("RUNTIME_APPROVAL_REQUIRED");
  return {
    operation: command === "resume" && !execute ? "resume-plan" : command,
    siteId,
    reason,
    planPath,
    outPath,
    approval,
    json: fields.has("--json"),
  };
}
async function writePlan(path: string, plan: NpAgentRuntimeResumePlanV1): Promise<void> {
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
async function readPlan(path: string): Promise<NpAgentRuntimeResumePlanV1> {
  const file = await open(resolve(path), "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > 4096)
      throw new NpAgentRuntimeControlError("RUNTIME_PLAN_INVALID");
    const bytes = Buffer.alloc(4097);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = await file.read(bytes, length, bytes.byteLength - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > 4096) throw new NpAgentRuntimeControlError("RUNTIME_PLAN_INVALID");
    return npRequireAgentRuntimeResumePlanV1(
      JSON.parse(bytes.subarray(0, length).toString("utf8")) as unknown,
    );
  } finally {
    await file.close();
  }
}
export interface NpRunAgentRuntimeProcessOptionsV1 {
  ensureFor: (intent: "read") => Promise<void>;
  shutdown: () => Promise<void>;
  resolveRuntimeControls?: () => NpAgentRuntimeControlsV1;
  env?: Readonly<Record<string, string | undefined>>;
  argv?: readonly string[];
  output?: Pick<Writable, "write">;
  readPlan?: (path: string) => Promise<NpAgentRuntimeResumePlanV1>;
  writePlan?: (path: string, plan: NpAgentRuntimeResumePlanV1) => Promise<void>;
}
/** One bootstrap owner and one bounded result; raw arguments/errors are never printed. */
export async function runAgentRuntimeProcessV1(
  options: NpRunAgentRuntimeProcessOptionsV1,
): Promise<number> {
  const output = options.output ?? process.stdout;
  const argv = options.argv ?? process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    output.write(AGENT_RUNTIME_HELP);
    return 0;
  }
  let input: NpAgentRuntimeCliInputV1 | null = null;
  let result: NpAgentRuntimeOpsResultV1;
  let bootstrapAttempted = false;
  try {
    input = parseAgentRuntimeArgsV1(argv);
    bootstrapAttempted = true;
    await options.ensureFor("read");
    const controls =
      options.resolveRuntimeControls?.() ??
      getOptionalAgentStudioServerRuntimeV1()?.runtimeControls ??
      createAgentRuntimeControlsV1({
        deploymentActorFingerprint: (options.env ?? process.env)
          .NP_AGENT_DEPLOYMENT_ACTOR_FINGERPRINT,
      });
    if (input.operation === "status") result = await controls.status({ siteId: input.siteId });
    else if (input.operation === "pause")
      result = await controls.pause({ siteId: input.siteId, reason: input.reason ?? "" });
    else if (input.operation === "resume-plan") {
      result = npRequireAgentRuntimeOpsResultV1(
        await controls.prepareResume({ siteId: input.siteId }),
      );
      if (result.plan) {
        const path = input.outPath ?? `.nexpress/agent-runtime/${result.plan.id}.json`;
        try {
          await (options.writePlan ?? writePlan)(path, result.plan);
        } catch {
          throw new NpAgentRuntimeControlError("RUNTIME_ARTIFACT_UNAVAILABLE");
        }
      }
    } else {
      let plan: NpAgentRuntimeResumePlanV1;
      try {
        plan = npRequireAgentRuntimeResumePlanV1(
          await (options.readPlan ?? readPlan)(input.planPath ?? ""),
        );
      } catch {
        throw new NpAgentRuntimeControlError("RUNTIME_PLAN_INVALID");
      }
      result = await controls.resume({
        siteId: input.siteId,
        plan,
        approval: input.approval ?? "",
      });
    }
    result = npRequireAgentRuntimeOpsResultV1(result);
  } catch (error) {
    const code: NpAgentRuntimeOpsErrorCodeV1 =
      error instanceof NpAgentRuntimeControlError ? error.code : "RUNTIME_UNAVAILABLE";
    result = npRequireAgentRuntimeOpsResultV1({
      schemaVersion: "np.agent-runtime-ops.v1",
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
        result = npRequireAgentRuntimeOpsResultV1({
          schemaVersion: "np.agent-runtime-ops.v1",
          operation: input?.operation ?? "status",
          outcome: "blocked",
          errorCode: "RUNTIME_UNAVAILABLE",
          status: null,
          plan: null,
        });
      }
    }
  }
  output.write(
    `${input?.json !== false ? JSON.stringify(result) : `Agent runtime ${result.operation}: ${result.outcome}${result.errorCode ? ` (${result.errorCode})` : ""}`}\n`,
  );
  return result.outcome === "blocked" ? 1 : 0;
}
