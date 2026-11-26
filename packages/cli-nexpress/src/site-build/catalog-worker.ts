import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  npBuildInstalledCatalogDigestV1,
  npParseBuildInstalledCatalogJsonV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  type NpAgentDesignDirectionDraftSetV1,
  type NpAgentBuildInstalledCatalogV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { freezeSiteBuildCapsuleV1 } from "./frozen-capsule.js";
import { createSiteNodeSandboxPolicyV1, siteNodeSandboxEnvironmentV1 } from "./sandbox-policy.js";

// Fixed worker source, not model-selected commands or a package-script substitution.
// Its result is a declaration catalog only, never rendering/execution provenance.
const worker = `import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { npCollectConfiguredBuildCatalogV1 } from '@nexpress/app/lib/site-build-catalog';
import { npGetDefaultBuildOwnerBindingsV1 } from '@nexpress/app/config-defaults';
const input = JSON.parse(await readFile(process.env.NP_BUILD_CAPSULE_INPUT, 'utf8'));
const config = (await import(pathToFileURL(input.config).href)).default;
const bindings = npGetDefaultBuildOwnerBindingsV1();
const { catalog } = input.proposal
  ? await (await import('@nexpress/app/lib/site-build-proposal')).npValidateConfiguredBuildDirectionSetV1(
      config, input.renderer, bindings, input.proposal.brief, input.proposal.set, 'draft')
  : await npCollectConfiguredBuildCatalogV1(config, input.renderer, bindings);
await writeFile(process.env.NP_BUILD_CAPSULE_RESULT, JSON.stringify(catalog), {flag:'wx',mode:0o600});
`;

export interface NpObservedSiteBuildCatalogV1 {
  catalog: NpAgentBuildInstalledCatalogV1;
  fingerprint: string;
  validationScope: "configured-declarations";
  executable: false;
}

/** Fresh filesystem observation and isolated config loading; never falls back to in-process imports. */
export async function observeSiteBuildCatalogV1(
  cwd: string,
  config: string,
): Promise<NpObservedSiteBuildCatalogV1> {
  return observeSiteBuildDeclarationsV1(cwd, config);
}

/** Installed schema/prop resolution only. No image or executable provenance is asserted. */
export async function observeSiteBuildDirectionDraftSetV1(
  cwd: string,
  config: string,
  briefValue: unknown,
  setValue: unknown,
): Promise<{
  catalog: NpAgentBuildInstalledCatalogV1;
  fingerprint: string;
  draftSet: NpAgentDesignDirectionDraftSetV1;
  validationScope: "installed-directions";
  executable: false;
}> {
  const brief = npRequireBuildReadyBriefV1(briefValue);
  const set = await npRequireBuildDirectionSetForBriefV1(brief, setValue, "draft");
  const observed = await observeSiteBuildDeclarationsV1(cwd, config, { brief, set });
  return { ...observed, draftSet: set, validationScope: "installed-directions" };
}

async function observeSiteBuildDeclarationsV1(
  cwd: string,
  config: string,
  proposal?: {
    brief: ReturnType<typeof npRequireBuildReadyBriefV1>;
    set: NpAgentDesignDirectionDraftSetV1;
  },
): Promise<NpObservedSiteBuildCatalogV1> {
  if (process.platform !== "darwin") throw new SiteBuildError("unavailable");
  const capsule = await freezeSiteBuildCapsuleV1(cwd, config);
  try {
    const node = await realpath(process.execPath);
    const driverRoot = join(capsule.project, ".nexpress/site/tmp");
    await mkdir(driverRoot, { recursive: true });
    const driver = join(driverRoot, "catalog-worker.mjs"),
      input = join(driverRoot, "catalog-input.json");
    const output = join(capsule.output, "catalog.json"),
      profile = join(capsule.root, "profile.sb");
    const loader = join(capsule.cliRoot, "dist/site-build-loader.js");
    if (!(await lstat(loader)).isFile()) throw new SiteBuildError("unavailable");
    await writeFile(driver, worker, { flag: "wx", mode: 0o400 });
    await writeFile(
      input,
      JSON.stringify({
        config: capsule.configFile,
        renderer: capsule.renderer,
        ...(proposal ? { proposal } : {}),
      }),
      { flag: "wx", mode: 0o400 },
    );
    await writeFile(
      profile,
      createSiteNodeSandboxPolicyV1({
        sourceRoot: capsule.project,
        dependencyRoot: capsule.dependencies,
        outputRoot: capsule.output,
        nodeExecutable: node,
        loopbackPorts: [],
        denyFork: true,
      }),
      { flag: "wx", mode: 0o600 },
    );
    const child = spawn(
      "/usr/bin/sandbox-exec",
      ["-f", profile, node, "--no-warnings", "--loader", loader, driver],
      {
        cwd: capsule.project,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...siteNodeSandboxEnvironmentV1(capsule.output),
          // Declaration import only: no database port is allowed by this profile.
          DATABASE_URL: "postgres://np_build_fixture:synthetic@127.0.0.1:61001/np_build_fixture",
          NP_SECRET: "np-build-synthetic-catalog-only-secret-v1",
          SITE_URL: "http://127.0.0.1:61000",
          NP_STORAGE_ADAPTER: "local",
          NP_EMAIL_ADAPTER: "noop",
          NP_JOBS_ENABLED: "0",
          NP_ENABLE_JOBS: "0",
          NP_BUILD_CAPSULE_PROJECT: capsule.project,
          NP_BUILD_CAPSULE_DEPENDENCIES: capsule.dependencies,
          NP_BUILD_CAPSULE_INPUT: input,
          NP_BUILD_CAPSULE_RESULT: output,
        },
      },
    );
    let overflow = false,
      total = 0;
    const kill = () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const bounded = (bytes: Buffer) => {
      total += bytes.length;
      if (total > 64 * 1024) {
        overflow = true;
        kill();
      }
    };
    child.stdout.on("data", bounded);
    child.stderr.on("data", bounded);
    const timer = setTimeout(kill, 30_000);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) =>
          code === 0 && signal === null && !overflow
            ? resolve()
            : reject(new SiteBuildError("input")),
        );
      });
    } finally {
      clearTimeout(timer);
      kill();
    }
    const info = await lstat(output);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4 * 1024 * 1024)
      throw new SiteBuildError("input");
    const catalog = npParseBuildInstalledCatalogJsonV1(await readFile(output, "utf8"));
    if (JSON.stringify(catalog.sourceCapsule) !== JSON.stringify(capsule.renderer))
      throw new SiteBuildError("input");
    await capsule.assertOriginalUnchanged();
    return {
      catalog,
      fingerprint: await npBuildInstalledCatalogDigestV1(catalog),
      validationScope: "configured-declarations",
      executable: false,
    };
  } catch {
    throw new SiteBuildError("input");
  } finally {
    await capsule.close();
  }
}
