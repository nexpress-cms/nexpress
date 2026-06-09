export function buildRunScriptArgs(
  manager: "pnpm" | "npm" | "yarn",
  script: string,
  passthrough: string[],
): string[] {
  if (manager === "yarn") return [script, ...passthrough];
  return ["run", script, "--", ...passthrough];
}

export interface OpsScriptInvocation {
  script:
    | "ops:status"
    | "doctor"
    | "ops:preflight"
    | "ops:health"
    | "ops:jobs"
    | "ops:storage"
    | "ops:plugins"
    | "release"
    | "runbook";
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
    case "storage":
      if (passthrough[0] !== "status") return null;
      return { script: "ops:storage", args: passthrough.slice(1) };
    case "plugins":
      if (passthrough[0] !== "list" && passthrough[0] !== "doctor") return null;
      return { script: "ops:plugins", args: passthrough };
    case "release":
      if (passthrough[0] !== "check" && passthrough[0] !== "verify") return null;
      return { script: "release", args: passthrough };
    case "runbook":
      if (!passthrough[0] || passthrough[0].startsWith("--")) return null;
      return { script: "runbook", args: passthrough };
    default:
      return null;
  }
}
