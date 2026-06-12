export function toProjectCommand(command: string): string {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized.startsWith("nexpress ")) return command;

  const parts = normalized.split(" ");
  if (parts[1] === "release") {
    return ["pnpm", "run", "ops:release", "--", ...parts.slice(2)].join(" ");
  }
  if (parts[1] === "runbook") {
    return ["pnpm", "run", "ops:runbook", "--", ...parts.slice(2)].join(" ");
  }
  if (parts[1] !== "ops" || !parts[2]) return command;

  const script = `ops:${parts[2]}`;
  return ["pnpm", "run", script, "--", ...parts.slice(3)].join(" ");
}
