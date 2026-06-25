import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { toProjectCommand } from "./ops-command-format.js";
import { resolveRuntimePath } from "./runtime-path.js";

export type OpsMutationMode = "dry-run" | "execute";

export interface OpsMutationAudit {
  action: string;
  mode: OpsMutationMode;
  approved: boolean;
  approvalToken: string;
  applied: boolean;
  artifactPath: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  rollbackHint: string | null;
  nextCommand: string | null;
  projectNextCommand: string | null;
}

export function buildOpsMutationAudit(args: {
  action: string;
  execute?: boolean;
  approve?: string | null;
  requiredApproval: string;
  artifactPath?: string | null;
  applied?: boolean;
  error?: string | null;
  rollbackHint?: string | null;
  nextCommand?: string | null;
  startedAt?: Date;
  completedAt?: Date | null;
}): OpsMutationAudit {
  const nextCommand = args.nextCommand ?? null;
  return {
    action: args.action,
    mode: args.execute ? "execute" : "dry-run",
    approved: Boolean(args.execute && args.approve === args.requiredApproval),
    approvalToken: args.requiredApproval,
    applied: args.applied ?? false,
    artifactPath: args.artifactPath ?? null,
    startedAt: (args.startedAt ?? new Date()).toISOString(),
    completedAt: args.completedAt === undefined ? null : (args.completedAt?.toISOString() ?? null),
    error: args.error ?? null,
    rollbackHint: args.rollbackHint ?? null,
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
  };
}

export function defaultOpsArtifactPath(kind: string, id: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `.nexpress/${kind}/${id}-${stamp}.json`;
}

export async function writeOpsJsonArtifact(path: string, value: unknown): Promise<void> {
  const resolved = resolveRuntimePath(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
