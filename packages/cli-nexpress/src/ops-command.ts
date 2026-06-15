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
    | "ops:contracts"
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
    case "contracts":
      return { script: "ops:contracts", args: passthrough };
    case "doctor":
      return { script: "doctor", args: passthrough };
    case "preflight":
      return { script: "ops:preflight", args: passthrough };
    case "health":
      return { script: "ops:health", args: passthrough };
    case "backup":
      if (
        passthrough[0] !== "create" &&
        passthrough[0] !== "status" &&
        passthrough[0] !== "list" &&
        !(
          passthrough[0] === "verify" &&
          Boolean(passthrough[1]) &&
          !passthrough[1]?.startsWith("--")
        ) &&
        passthrough[0] !== "restore-plan"
      ) {
        return null;
      }
      return { script: "ops:backup", args: passthrough };
    case "jobs":
      if (
        passthrough[0] !== "pause" &&
        passthrough[0] !== "resume" &&
        passthrough[0] !== "status" &&
        passthrough[0] !== "retry-all" &&
        passthrough[0] !== "drain"
      ) {
        return null;
      }
      return {
        script: "ops:jobs",
        args: passthrough[0] === "status" ? passthrough.slice(1) : passthrough,
      };
    case "migrate":
      if (
        passthrough[0] !== "status" &&
        passthrough[0] !== "plan" &&
        passthrough[0] !== "rollback-plan"
      ) {
        return null;
      }
      return { script: "ops:migrate", args: passthrough };
    case "storage":
      if (passthrough[0] === "status") {
        return { script: "ops:storage", args: passthrough.slice(1) };
      }
      if (
        passthrough[0] === "verify" ||
        passthrough[0] === "missing-files" ||
        passthrough[0] === "orphaned-files" ||
        passthrough[0] === "test" ||
        (passthrough[0] === "migrate" && passthrough[1] === "plan")
      ) {
        return { script: "ops:storage", args: passthrough };
      }
      return null;
    case "plugins":
      if (
        passthrough[0] !== "list" &&
        passthrough[0] !== "doctor" &&
        !(
          passthrough[0] === "inspect" &&
          Boolean(passthrough[1]) &&
          !passthrough[1]?.startsWith("--")
        ) &&
        passthrough[0] !== "upgrade-plan"
      ) {
        return null;
      }
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
