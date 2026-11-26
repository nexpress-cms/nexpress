import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-fixed-loader-test-")));
  roots.push(root);
  await mkdir(join(root, "src"));
  return root;
}
async function execute(root: string, source: string) {
  const entry = join(root, "entry.mjs");
  await writeFile(entry, source);
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--loader",
          fileURLToPath(new URL("../../dist/site-build-loader.js", import.meta.url)),
          entry,
        ],
        {
          cwd: root,
          env: {
            NP_BUILD_CAPSULE_PROJECT: root,
            NP_BUILD_CAPSULE_DEPENDENCIES: join(root, "node_modules"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
      child.stdout.on("data", (bytes: Buffer) => {
        stdout += bytes.toString();
        if (stdout.length > 65536) child.kill("SIGKILL");
      });
      child.stderr.on("data", (bytes: Buffer) => {
        stderr += bytes.toString();
        if (stderr.length > 65536) child.kill("SIGKILL");
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    },
  );
}
describe("shipped fixed TypeScript capsule loader", () => {
  it("loads the normal scaffold's dotted config alias and extensionless generated schema", async () => {
    const root = await project();
    await mkdir(join(root, "src/db/generated"), { recursive: true });
    await writeFile(
      join(root, "src/nexpress.config.ts"),
      "const value: string = 'normal-config'; export default value;",
    );
    await writeFile(
      join(root, "src/db/generated/collections.ts"),
      "export const generated: boolean = true;",
    );
    const result = await execute(
      root,
      "import config from '@/nexpress.config';import {generated} from '@/db/generated/collections';console.log(JSON.stringify({config,generated}));",
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result).toMatchObject({
      code: 0,
      stdout: '{"config":"normal-config","generated":true}\n',
    });
  });
  it("keeps known .js-to-.ts resolution while rejecting alias traversal and symlink escapes", async () => {
    const root = await project();
    await writeFile(join(root, "src/local.ts"), "export const value=42;");
    const ordinary = await execute(
      root,
      "import {value} from './src/local.js';console.log(value);",
    );
    expect(ordinary.code, ordinary.stderr).toBe(0);
    expect(ordinary).toMatchObject({ code: 0, stdout: "42\n" });
    const outside = await project();
    await writeFile(
      join(outside, "escape.ts"),
      "console.log('OUTSIDE-EXECUTED'); export default 1;",
    );
    await symlink(join(outside, "escape.ts"), join(root, "src/escape.config.ts"));
    const escaped = await execute(root, "import value from '@/escape.config';console.log(value);");
    expect(escaped.code).not.toBe(0);
    expect(escaped.stdout).not.toContain("OUTSIDE-EXECUTED");
    const traversal = await execute(root, "import value from '@/../entry.mjs';console.log(value);");
    expect(traversal.code).not.toBe(0);
  });
});
