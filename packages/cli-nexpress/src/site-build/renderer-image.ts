import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SiteBuildError } from "./artifact-io.js";

/** Image fonts only; no user directories, includes, mutable system cache or rescan. */
export const NP_SITE_BUILD_RENDERER_FONTCONFIG_V1 = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>/usr/share/fonts</dir>
  <cachedir>/np/output/font-cache</cachedir>
  <alias><family>sans-serif</family><prefer><family>DejaVu Sans</family></prefer></alias>
  <alias><family>serif</family><prefer><family>DejaVu Serif</family></prefer></alias>
  <alias><family>monospace</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
  <config><rescan><int>0</int></rescan></config>
</fontconfig>
`;

/** Fixed provisioning recipe only. Runtime containers never receive build-time network access. */
export const NP_SITE_BUILD_RENDERER_BASE_DOCKERFILE_V1 = `FROM node:24.11.1-bookworm-slim AS node
FROM postgres:16-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-dejavu-core ca-certificates gcc libc6-dev && rm -rf /var/lib/apt/lists/*
RUN /usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js install --global pnpm@10.33.0 --ignore-scripts --no-audit --no-fund
RUN mkdir -p /opt/np && cp -a /usr/lib/chromium /opt/np/chromium && mv /opt/np/chromium/chromium /opt/np/chromium/chrome
RUN mkdir -p /opt/np/postgres-template && chown postgres:postgres /opt/np/postgres-template && printf '%s\\n' 'np-build-synthetic-fixture-password-v1' > /tmp/np-fixture-password && chown postgres:postgres /tmp/np-fixture-password
USER postgres
RUN /usr/lib/postgresql/16/bin/initdb --no-locale --encoding=UTF8 --auth-local=trust --auth-host=scram-sha-256 --username=np_build_fixture --pwfile=/tmp/np-fixture-password -D /opt/np/postgres-template > /dev/null
USER root
RUN rm /tmp/np-fixture-password && find /opt/np/postgres-template -type d -exec chmod 0555 {} + && find /opt/np/postgres-template -type f -exec chmod 0444 {} + && mkdir -p /opt/np/driver
ENTRYPOINT []
CMD ["/usr/local/bin/node", "--version"]
`;

interface DockerResult {
  stdout: string;
  stderr: string;
}
interface LocalDocker {
  endpoint: string;
  config: string;
}

const SAFE_PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin";

/** No shell or inherited registry credentials; only a verified local Unix socket. */
async function docker(
  host: LocalDocker,
  args: readonly string[],
  timeoutMs = 30_000,
  maxBytes = 1024 * 1024,
): Promise<DockerResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("docker", ["--host", host.endpoint, ...args], {
      env: {
        PATH: SAFE_PATH,
        HOME: host.config,
        DOCKER_CONFIG: host.config,
        DOCKER_BUILDKIT: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let total = 0,
      overflow = false,
      expired = false;
    const stop = () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const collect = (target: Buffer[]) => (bytes: Buffer) => {
      total += bytes.length;
      if (total > maxBytes) {
        overflow = true;
        stop();
      } else target.push(bytes);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const timer = setTimeout(() => {
      expired = true;
      stop();
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new SiteBuildError("unavailable"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal !== null || overflow || expired)
        reject(new SiteBuildError("unavailable"));
      else
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
    });
  });
}

async function localEndpoint(): Promise<string> {
  // Context inspection is read-only. Do not pass the user's Docker config to a build/pull/run.
  const value = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "docker",
      ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
      {
        env: {
          PATH: SAFE_PATH,
          ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
          ...(process.env.DOCKER_CONTEXT ? { DOCKER_CONTEXT: process.env.DOCKER_CONTEXT } : {}),
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let text = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.on("data", (bytes: Buffer) => {
      text += bytes.toString("utf8");
      if (text.length > 4096) child.kill("SIGKILL");
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new SiteBuildError("unavailable"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal !== null) reject(new SiteBuildError("unavailable"));
      else resolve(text.trim());
    });
  });
  if (
    !value.startsWith("unix:///") ||
    value.length > 2048 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) <= 32 || "?%#".includes(character),
    )
  )
    throw new SiteBuildError("unavailable");
  const path = await realpath(value.slice("unix://".length));
  return `unix://${path}`;
}

export interface NpPreparedSiteBuildRendererBaseV1 {
  schemaVersion: "np.site-build-renderer-base.v1";
  imageId: string;
  recipeDigest: string;
  architecture: "arm64" | "amd64";
  nodeVersion: "v24.11.1";
  provisioned: true;
}

/** Explicit local provisioning only. This does not render a direction or start a site/database. */
export async function prepareSiteBuildRendererBaseV1(): Promise<NpPreparedSiteBuildRendererBaseV1> {
  const root = await mkdtemp(join(tmpdir(), "np-renderer-provision-"));
  try {
    const host = { endpoint: await localEndpoint(), config: root };
    const platform = (
      await docker(host, ["info", "--format", "{{.OSType}} {{.Architecture}}"])
    ).stdout.trim();
    const architecture =
      platform === "linux aarch64" || platform === "linux arm64"
        ? "arm64"
        : platform === "linux x86_64" || platform === "linux amd64"
          ? "amd64"
          : null;
    if (!architecture) throw new SiteBuildError("unavailable");
    const recipeDigest = createHash("sha256")
      .update(NP_SITE_BUILD_RENDERER_BASE_DOCKERFILE_V1)
      .digest("hex");
    const tag = `nexpress-site-build-base:${recipeDigest}`;
    const cached = (
      await docker(
        host,
        ["image", "ls", "--no-trunc", "--filter", `reference=${tag}`, "--format", "{{.ID}}"],
        30_000,
        4096,
      )
    ).stdout.trim();
    if (cached && !/^sha256:[a-f0-9]{64}$/u.test(cached)) throw new SiteBuildError("unavailable");
    await writeFile(join(root, "Dockerfile"), NP_SITE_BUILD_RENDERER_BASE_DOCKERFILE_V1, {
      flag: "wx",
      mode: 0o400,
    });
    const iidfile = join(root, "image-id");
    if (!cached)
      await docker(
        host,
        [
          "build",
          "--network",
          "default",
          "--label",
          `org.nexpress.build.recipe=${recipeDigest}`,
          "--tag",
          tag,
          "--iidfile",
          iidfile,
          root,
        ],
        15 * 60_000,
        2 * 1024 * 1024,
      );
    // The local Docker daemon is the framework host. Reuse this recipe's pinned
    // image; regenerating initdb on every render would change the environment
    // identity and make independent rerender verification impossible.
    const imageId = cached || (await readFile(iidfile, "utf8")).trim();
    if (!/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new SiteBuildError("unavailable");
    const inspected = (
      await docker(host, [
        "image",
        "inspect",
        imageId,
        "--format",
        '{{.Id}} {{.Architecture}} {{index .Config.Labels "org.nexpress.build.recipe"}}',
      ])
    ).stdout.trim();
    if (inspected !== `${imageId} ${architecture} ${recipeDigest}`)
      throw new SiteBuildError("unavailable");
    const version = (
      await docker(host, [
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--entrypoint",
        "/usr/local/bin/node",
        imageId,
        "--version",
      ])
    ).stdout.trim();
    if (version !== "v24.11.1") throw new SiteBuildError("unavailable");
    return {
      schemaVersion: "np.site-build-renderer-base.v1",
      imageId,
      recipeDigest,
      architecture,
      nodeVersion: version,
      provisioned: true,
    };
  } catch {
    throw new SiteBuildError("unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
