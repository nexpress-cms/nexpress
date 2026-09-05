import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const temporaryProjects: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("ops plugins CLI pipe output", () => {
  it.each([true, false])(
    "drains a large JSON inventory before exiting (ok=%s)",
    async (ok) => {
      const cwd = await mkdtemp(join(tmpdir(), "np-ops-plugins-cli-"));
      temporaryProjects.push(cwd);
      const plugins = Array.from({ length: 200 }, (_, index) => ({
        manifest: {
          id: `pipe-fixture-${index.toString()}`,
          name: `Pipe fixture ${index.toString()}`,
          version: "1.0.0",
        },
      }));
      if (!ok) plugins[plugins.length - 1].manifest.id = "invalid plugin id";
      await writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" }));
      await writeFile(
        join(cwd, "nexpress.config.ts"),
        `export default ${JSON.stringify({ plugins })};\n`,
      );
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolveRun, reject) => {
          const child = spawn("tsx", [join(scriptDir, "ops-plugins.ts"), "doctor", "--json"], {
            cwd,
            env: {
              ...process.env,
              NP_ROOT_ENV_PATH: "",
              PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
            },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 20_000,
          });
          let stdout = "";
          let stderr = "";
          let resume: NodeJS.Timeout | undefined;
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.once("data", () => {
            child.stdout.pause();
            resume = setTimeout(() => child.stdout.resume(), 200);
          });
          child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
          });
          child.on("error", reject);
          child.on("close", (code) => {
            clearTimeout(resume);
            resolveRun({ code, stdout, stderr });
          });
        },
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(ok ? 0 : 1);
      expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(65_536);
      const report = JSON.parse(result.stdout) as {
        ok: boolean;
        plugins: unknown[];
        schemaVersion: string;
      };
      expect(report.schemaVersion).toBe("np.ops-plugins.v1");
      expect(report.ok).toBe(ok);
      expect(report.plugins).toHaveLength(200);
    },
    30_000,
  );
});
