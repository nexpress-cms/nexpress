export function toProjectCommand(command: string): string {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized.startsWith("nexpress ")) return command;

  const parts = normalized.split(" ");
  if (parts[1] === "release") {
    return formatProjectRun("ops:release", parts.slice(2));
  }
  if (parts[1] === "runbook") {
    return formatProjectRun("ops:runbook", parts.slice(2));
  }
  if (parts[1] !== "ops" || !parts[2]) return command;

  const script = `ops:${parts[2]}`;
  return formatProjectRun(script, parts.slice(3));
}

export function normalizePnpmPassthroughArgv(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

export function isMatchingProjectCommand(command: string, projectCommand: string): boolean {
  return projectCommandCandidates(command).includes(projectCommand.trim().replace(/\s+/g, " "));
}

function projectCommandCandidates(command: string): string[] {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized.startsWith("nexpress ")) return [normalized];

  const current = toProjectCommand(normalized);
  const legacy = current.replace(/^pnpm --silent run /, "pnpm run ");
  return [...new Set([current, legacy])];
}

function formatProjectRun(script: string, passthrough: string[]): string {
  const prefix = passthrough.includes("--json") ? ["pnpm", "--silent", "run"] : ["pnpm", "run"];
  return [...prefix, script, "--", ...passthrough].join(" ");
}
