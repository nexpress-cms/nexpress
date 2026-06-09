export function buildRunScriptArgs(
  manager: "pnpm" | "npm" | "yarn",
  script: string,
  passthrough: string[],
): string[] {
  if (manager === "yarn") return [script, ...passthrough];
  return ["run", script, "--", ...passthrough];
}

export interface OpsScriptInvocation {
  script: "ops:status" | "doctor" | "ops:preflight" | "ops:health" | "ops:jobs";
  args: string[];
}

export function resolveOpsScriptInvocation(
  subcommand: string | undefined,
  passthrough: string[],
): OpsScriptInvocation | null {
  switch (subcommand) {
    case "status":
      return { script: "ops:status", args: passthrough };
    case "doctor":
      return { script: "doctor", args: passthrough };
    case "preflight":
      return { script: "ops:preflight", args: passthrough };
    case "health":
      return { script: "ops:health", args: passthrough };
    case "jobs":
      if (passthrough[0] !== "status") return null;
      return { script: "ops:jobs", args: passthrough.slice(1) };
    default:
      return null;
  }
}
