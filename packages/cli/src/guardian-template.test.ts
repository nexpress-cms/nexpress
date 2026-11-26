import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getProjectFiles } from "./templates.js";
describe("Guardian local control scaffold", () => {
  it("matches the thin reference wrapper and adds only an explicit local command", () => {
    const files = getProjectFiles({
      projectName: "guardian-fixture",
      projectPath: "guardian-fixture",
      dockerSetup: true,
      localMode: true,
      secret: "test-secret-32characters-min-aaaaaaaaaaaa",
      dbPort: 5500,
    });
    const script = files["scripts/agent-guardian.ts"];
    expect(script.encoding).toBe("utf8");
    expect(script.content).toBe(
      readFileSync(
        resolve(import.meta.dirname, "../../../apps/web/scripts/agent-guardian.ts"),
        "utf8",
      ),
    );
    expect(script.content).toContain("runAgentGuardianProcessV1");
    expect(script.content).toContain("shutdownBootstrap");
    expect(script.content).not.toMatch(/worker|provider|token|setGuardian/iu);
    const pkg = JSON.parse(files["package.json"].content) as { scripts: Record<string, string> };
    expect(pkg.scripts["agent:guardian"]).toBe("tsx scripts/agent-guardian.ts");
  });
});
