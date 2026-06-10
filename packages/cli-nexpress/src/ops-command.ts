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
    | "ops:backup"
    | "ops:jobs"
    | "ops:migrate"
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
    case "backup":
      if (
        passthrough[0] !== "status" &&
        passthrough[0] !== "list" &&
        !(passthrough[0] === "verify" && passthrough[1] === "latest")
      ) {
        return null;
      }
      return { script: "ops:backup", args: passthrough };
    case "jobs":
      if (passthrough[0] !== "status") return null;
      return { script: "ops:jobs", args: passthrough.slice(1) };
    case "migrate":
      if (passthrough[0] !== "status" && passthrough[0] !== "plan") return null;
      return { script: "ops:migrate", args: passthrough };
    case "storage":
      if (passthrough[0] !== "status") return null;
      return { script: "ops:storage", args: passthrough.slice(1) };
    case "plugins":
      if (passthrough[0] !== "list" && passthrough[0] !== "doctor") return null;
      return { script: "ops:plugins", args: passthrough };
    case "release":
      if (
        passthrough[0] !== "apply" &&
        passthrough[0] !== "check" &&
        passthrough[0] !== "plan" &&
        passthrough[0] !== "verify"
      ) {
        return null;
      }
      return { script: "release", args: passthrough };
    case "runbook":
      if (!passthrough[0] || passthrough[0].startsWith("--")) return null;
      return { script: "runbook", args: passthrough };
    default:
      return null;
  }
}
