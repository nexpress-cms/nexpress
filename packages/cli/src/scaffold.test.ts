import { describe, expect, it } from "vitest";

import { buildSuccessLines } from "./scaffold.js";

describe("buildSuccessLines", () => {
  it("prints focused setup-first next steps and deploy preflight guidance", () => {
    const output = buildSuccessLines("demo-site", "demo-site", true, false).join("\n");

    expect(output).toContain("Project created at ./demo-site");
    expect(output).toContain("cd demo-site");
    expect(output).toContain("pnpm install");
    expect(output).not.toContain("(or npm install)");
    expect(output).toContain("docker compose -f docker/docker-compose.yml up -d db");
    expect(output).toContain("pnpm run setup      (wizard: DB / secret / storage / migrations)");
    expect(output).toContain("pnpm dev");
    expect(output).toContain("Useful checks:");
    expect(output).toContain("pnpm run ops:status -- --brief --no-color");
    expect(output).toContain("pnpm run doctor");
    expect(output).toContain("Deploy bridge:");
    expect(output).toContain("pnpm run deploy:plan -- --target vercel --brief --no-color");
    expect(output).toContain("pnpm db:migrate");
    expect(output).toContain("pnpm run ops:preflight -- --target vercel --brief --no-color");
    expect(output).toContain("pnpm --silent run ops:release -- check --target vercel --json");
    expect(output).toContain(
      "pnpm --silent run ops:release -- verify --url https://your-domain.example --json",
    );
    expect(output).toContain("More ops commands live in docs/ops.md");
    expect(output).not.toContain("Jobs: pnpm run ops:jobs");
    expect(output).not.toContain("Before deploying:");
  });

  it("keeps local-mode commands workspace-aware", () => {
    const output = buildSuccessLines("demo-site", "apps/demo-site", false, true).join("\n");

    expect(output).toContain("Local mode: @nexpress/* deps use workspace:*");
    expect(output).toContain(
      "pnpm install         (run from the monorepo root — uses workspace:* links)",
    );
    expect(output).toContain("cd apps/demo-site");
    expect(output).toContain("pnpm --filter demo-site run setup");
    expect(output).toContain("pnpm --filter demo-site dev");
    expect(output).not.toContain("docker compose -f docker/docker-compose.yml up -d db");
  });
});
