export type DeployTarget = "vercel" | "railway" | "render" | "fly" | "docker";

export const DEPLOY_TARGETS = [
  "vercel",
  "railway",
  "render",
  "fly",
  "docker",
] as const satisfies readonly DeployTarget[];

export function isDeployTarget(value: string): value is DeployTarget {
  return DEPLOY_TARGETS.includes(value as DeployTarget);
}

export function parseDeployTargetArg(argv: string[]): DeployTarget | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--target") {
      const next = argv[i + 1];
      if (!next || !isDeployTarget(next)) {
        throw new Error(`--target must be one of: ${DEPLOY_TARGETS.join(", ")}`);
      }
      return next;
    }
    if (arg.startsWith("--target=")) {
      const value = arg.slice("--target=".length);
      if (!isDeployTarget(value)) {
        throw new Error(`--target must be one of: ${DEPLOY_TARGETS.join(", ")}`);
      }
      return value;
    }
  }
  return null;
}

export function inferDeployTargetFromEnv(
  env: Record<string, string | undefined> = process.env,
): DeployTarget | null {
  if (env.VERCEL) return "vercel";
  if (env.RAILWAY_ENVIRONMENT_NAME) return "railway";
  if (env.RENDER) return "render";
  if (env.FLY_APP_NAME || env.FLY_REGION) return "fly";
  return null;
}

export function deployTargetTitle(target: DeployTarget): string {
  switch (target) {
    case "vercel":
      return "Vercel";
    case "railway":
      return "Railway";
    case "render":
      return "Render";
    case "fly":
      return "Fly.io";
    case "docker":
      return "Docker";
  }
}
