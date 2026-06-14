import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * End-to-end spawn tests for `packages/app/src/scripts/setup-server.ts`.
 *
 * The wizard's previous bugs in this session — CLI mode hardcoding
 * `:5433` over the scaffold's `.env` port (#829), `seed:content` /
 * `worker` crashing at module load with `ERR_MODULE_NOT_FOUND:
 * @/lib` (#834) — all manifested at SCRIPT EXECUTION time and slipped
 * past `tsc --noEmit`. Pure-function unit tests on
 * `setup-server-validate` / `setup-server-errors` covered their
 * surfaces, but the parts of `setup-server.ts` that read / write
 * `.env`, branch on the mode flag, and orchestrate the bootstrap
 * chain were never exercised in CI. These tests fix that — each
 * test spawns the actual script as a child process and asserts on
 * its exit code, output, and the `.env` it writes.
 *
 * The script is invoked via `node --import tsx/dist/loader.mjs`
 * (NOT `pnpm exec tsx`) so the test doesn't depend on the spawn's
 * cwd being a pnpm workspace. Each test gets its own tmp dir for
 * `NP_SETUP_ENV_PATH`; the wizard never touches the repo's own
 * `.env`.
 */

// Fixed 64-char NP_SECRET with enough distinct characters to pass the
// wizard's low-entropy guard (rejects strings with < 8 distinct chars).
const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const SETUP_SERVER_PATH = fileURLToPath(
  new URL("../../../packages/app/src/scripts/setup-server.ts", import.meta.url),
);

const TSX_LOADER = fileURLToPath(
  new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url),
);

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  envContent: string | null;
}

interface RunOptions {
  envPath: string;
  env?: Record<string, string>;
  args?: string[];
  stdin?: string;
  timeoutMs?: number;
}

async function runWizard(opts: RunOptions): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolvePromise) => {
    const proc = spawn("node", ["--import", TSX_LOADER, SETUP_SERVER_PATH, ...(opts.args ?? [])], {
      env: {
        // Strip the OUTER process.env so the host's DATABASE_URL /
        // NP_SECRET don't bleed into the wizard. `PATH` / `HOME` /
        // tsx-needed bits stay.
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_OPTIONS: "",
        // The wizard reads NP_SETUP_ENV_PATH to know where to
        // write .env. Without this it'd write to process.cwd()/.env.
        NP_SETUP_ENV_PATH: opts.envPath,
        // Force a known DB-name default so the test isn't sensitive
        // to whatever the tmp dir is named.
        NP_SETUP_DB_NAME: "testproj",
        ...opts.env,
      },
      // cwd doesn't matter — env vars steer the script.
      cwd: dirname(opts.envPath),
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (opts.stdin !== undefined) proc.stdin.write(opts.stdin);
    proc.stdin.end();

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
    }, opts.timeoutMs ?? 8_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        code,
        stdout,
        stderr,
        envContent: existsSync(opts.envPath) ? readFileSync(opts.envPath, "utf8") : null,
      });
    });
  });
}

describe("setup-server.ts end-to-end (spawn)", () => {
  let tempDir: string;
  let envPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), "np-setup-test-"));
    envPath = resolve(tempDir, ".env");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("non-interactive mode", () => {
    it("writes a complete .env with default config", async () => {
      const result = await runWizard({
        envPath,
        env: {
          NP_SETUP_NONINTERACTIVE: "1",
          DATABASE_URL: "postgres://nexpress:nexpress@localhost:6137/testproj",
          NP_SECRET: TEST_SECRET,
          SITE_URL: "http://localhost:3000",
          NP_SETUP_RUN_MIGRATIONS: "false",
          NP_SETUP_CREATE_ADMIN: "false",
        },
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.envContent).not.toBeNull();
      expect(result.envContent).toMatch(/DATABASE_URL=postgres:\/\/.*:6137\/testproj/);
      expect(result.envContent).toMatch(new RegExp(`^NP_SECRET=${TEST_SECRET}$`, "m"));
    });

    it("writes NEXPRESS_DB_PORT line when DATABASE_URL port != 5433", async () => {
      // Regression for #829: scaffolds that pick a non-default port
      // must have BOTH `DATABASE_URL` and `NEXPRESS_DB_PORT` in `.env`,
      // otherwise `docker compose` (which reads NEXPRESS_DB_PORT) and
      // the app (which reads DATABASE_URL) disagree on which port to
      // bind / connect to.
      const result = await runWizard({
        envPath,
        env: {
          NP_SETUP_NONINTERACTIVE: "1",
          DATABASE_URL: "postgres://nexpress:nexpress@localhost:5500/testproj",
          NP_SECRET: TEST_SECRET,
          NP_SETUP_RUN_MIGRATIONS: "false",
          NP_SETUP_CREATE_ADMIN: "false",
        },
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.envContent).toMatch(/^NEXPRESS_DB_PORT=5500$/m);
    });

    it("omits NEXPRESS_DB_PORT line when DATABASE_URL port == 5433 (default)", async () => {
      // The compose template's `${NEXPRESS_DB_PORT:-5433}` fallback
      // already binds 5433 in the default case, so writing the line
      // would just be noise.
      const result = await runWizard({
        envPath,
        env: {
          NP_SETUP_NONINTERACTIVE: "1",
          DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/testproj",
          NP_SECRET: TEST_SECRET,
          NP_SETUP_RUN_MIGRATIONS: "false",
          NP_SETUP_CREATE_ADMIN: "false",
        },
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.envContent).not.toMatch(/^NEXPRESS_DB_PORT=/m);
    });

    it("preserves TEST_DATABASE_URL when provided via env", async () => {
      // Regression for #829's side-fix: CLI mode dropped this line
      // on rewrite. Non-interactive mode picks it up from process.env.
      const result = await runWizard({
        envPath,
        env: {
          NP_SETUP_NONINTERACTIVE: "1",
          DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/testproj",
          TEST_DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/testproj_test",
          NP_SECRET: TEST_SECRET,
          NP_SETUP_RUN_MIGRATIONS: "false",
          NP_SETUP_CREATE_ADMIN: "false",
        },
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.envContent).toMatch(/TEST_DATABASE_URL=postgres:\/\/.*:5433\/testproj_test/);
    });

    it("uses existing .env values as non-interactive defaults", async () => {
      writeFileSync(
        envPath,
        [
          "DATABASE_URL=postgres://nexpress:nexpress@localhost:6138/existingproj",
          "TEST_DATABASE_URL=postgres://nexpress:nexpress@localhost:6138/existingproj_test",
          `NP_SECRET=${TEST_SECRET}`,
          "SITE_URL=http://localhost:4010",
          "NP_SETUP_RUN_MIGRATIONS=false",
          "NP_SETUP_CREATE_ADMIN=false",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await runWizard({
        envPath,
        env: {
          NP_SETUP_NONINTERACTIVE: "1",
        },
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.envContent).toMatch(
        /DATABASE_URL=postgres:\/\/nexpress:nexpress@localhost:6138\/existingproj/,
      );
      expect(result.envContent).toMatch(/^NEXPRESS_DB_PORT=6138$/m);
      expect(result.envContent).toMatch(/^SITE_URL=http:\/\/localhost:4010$/m);
    });

    it("exits non-zero with a helpful error when DATABASE_URL is missing", async () => {
      const result = await runWizard({
        envPath,
        env: {
          NP_SETUP_NONINTERACTIVE: "1",
          NP_SECRET: TEST_SECRET,
          NP_SETUP_RUN_MIGRATIONS: "false",
        },
      });
      expect(result.code).not.toBe(0);
      // Both the validation message AND the env-var helper block.
      expect(result.stderr).toMatch(/DATABASE_URL/);
    });

    it("rewriting an existing .env backs up the prior file to .env.bak", async () => {
      writeFileSync(envPath, "EXISTING=value\n", "utf8");

      const result = await runWizard({
        envPath,
        env: {
          NP_SETUP_NONINTERACTIVE: "1",
          DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/testproj",
          NP_SECRET: TEST_SECRET,
          NP_SETUP_RUN_MIGRATIONS: "false",
          NP_SETUP_CREATE_ADMIN: "false",
        },
      });

      expect(result.code, result.stderr).toBe(0);
      const bakPath = `${envPath}.bak`;
      expect(existsSync(bakPath)).toBe(true);
      expect(readFileSync(bakPath, "utf8")).toMatch(/^EXISTING=value$/m);
    });
  });

  describe("module load (no @/-alias crashes)", () => {
    it("starts cleanly under non-interactive mode (no ERR_MODULE_NOT_FOUND)", async () => {
      // Belt-and-braces: the scaffold-smoke CI job already runs the
      // dist'd scripts in a packed scaffold, but this catches a
      // regression where editing the source breaks module load
      // BEFORE a publish happens.
      const result = await runWizard({
        envPath,
        env: {
          NP_SETUP_NONINTERACTIVE: "1",
          DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/testproj",
          NP_SECRET: TEST_SECRET,
          NP_SETUP_RUN_MIGRATIONS: "false",
          NP_SETUP_CREATE_ADMIN: "false",
        },
      });
      // Even if the script errors for some other reason, the stderr
      // must not carry the import-resolution failure signature.
      expect(result.stderr).not.toMatch(
        /ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find package|Cannot find module/,
      );
    });
  });

  describe("HTTP mode", () => {
    it("prints copy-pasteable setup mode fallbacks", async () => {
      const result = await runWizard({
        envPath,
        env: {
          DISPLAY: ":99",
        },
        timeoutMs: 1_000,
      });

      expect(result.stdout).toContain("pnpm run setup -- --cli");
      expect(result.stdout).toContain("pnpm run setup -- --non-interactive");
      expect(result.stdout).not.toContain("pnpm setup --cli");
      expect(result.stdout).not.toContain("pnpm setup --non-interactive");
    });
  });

  describe("CLI mode", () => {
    it("default DATABASE_URL prompt is read from the existing .env", async () => {
      // Regression for #829: pre-fix, CLI mode used
      // `process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL` (= the
      // hardcoded :5433/nexpress) regardless of what `.env` said. The
      // scaffold's unique-port mechanism was silently defeated.
      writeFileSync(
        envPath,
        "DATABASE_URL=postgres://nexpress:nexpress@localhost:6137/myproj\n" +
          "NEXPRESS_DB_PORT=6137\n",
        "utf8",
      );

      // Pipe EOF immediately — the wizard prints the first prompt with
      // the default shown in brackets, then exits when readline gets
      // EOF. We just need the stdout to capture the bracketed default.
      const result = await runWizard({
        envPath,
        args: ["--cli"],
        stdin: "",
        timeoutMs: 5_000,
      });

      // The CLI's first prompt is the DATABASE_URL question. Its
      // default (in square brackets) MUST reflect what's in .env, not
      // the hardcoded :5433.
      expect(result.stdout).toMatch(/postgres:\/\/.*:6137\/myproj/);
      expect(result.stdout).not.toMatch(/\[postgres:\/\/.*:5433\/testproj\]/);
    });

    it("falls back to localhost:5433 + dir-derived db name when no .env exists", async () => {
      // Sanity: with no .env, the wizard's prompts have to come from
      // somewhere. Confirm the fallback shape so a future broken
      // `getFormDefaults` doesn't silently substitute `null`s or
      // garbage.
      const result = await runWizard({
        envPath,
        args: ["--cli"],
        stdin: "",
        timeoutMs: 5_000,
      });
      expect(result.stdout).toMatch(/postgres:\/\/.*localhost:5433\/testproj/);
    });
  });
});
