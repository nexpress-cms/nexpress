import { describe, expect, it } from "vitest";

import { buildSuccessLines } from "./scaffold.js";

describe("buildSuccessLines", () => {
  it("prints setup-first next steps and deploy preflight guidance", () => {
    const output = buildSuccessLines("demo-site", true, false).join("\n");

    expect(output).toContain("Project created at ./demo-site");
    expect(output).toContain("cd demo-site");
    expect(output).toContain("pnpm install        (or npm install)");
    expect(output).toContain("docker compose -f docker/docker-compose.yml up -d db");
    expect(output).toContain("pnpm run setup      (wizard: DB / secret / storage / migrations)");
    expect(output).toContain("pnpm dev");
    expect(output).toContain("Status: pnpm run ops:status -- --brief --no-color");
    expect(output).toContain("Jobs: pnpm run ops:jobs -- --brief --no-color");
    expect(output).toContain("Storage: pnpm run ops:storage -- --brief --no-color");
    expect(output).toContain("Plugins: pnpm run ops:plugins -- doctor --brief --no-color");
    expect(output).toContain("Stuck? pnpm run doctor");
    expect(output).toContain("Deploy preflight:");
    expect(output).toContain("pnpm run ops:preflight -- --target vercel --brief --no-color");
    expect(output).toContain(
      "pnpm run ops:health -- --url http://localhost:3000 --brief --no-color",
    );
    expect(output).toContain("pnpm run doctor:prod -- --target vercel --fix-plan");
    expect(output).not.toContain("Before deploying:");
  });

  it("keeps local-mode commands workspace-aware", () => {
    const output = buildSuccessLines("apps/demo-site", false, true).join("\n");

    expect(output).toContain("Local mode: @nexpress/* deps use workspace:*");
    expect(output).toContain(
      "pnpm install         (run from the monorepo root — uses workspace:* links)",
    );
    expect(output).toContain("pnpm --filter apps/demo-site run setup");
    expect(output).toContain("pnpm --filter apps/demo-site dev");
    expect(output).not.toContain("docker compose -f docker/docker-compose.yml up -d db");
  });
});
