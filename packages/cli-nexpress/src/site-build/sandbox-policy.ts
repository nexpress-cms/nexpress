import { dirname, isAbsolute, resolve } from "node:path";
import { SiteBuildError } from "./artifact-io.js";

export const SITE_NODE_SANDBOX_POLICY_V1 = "np.build-node-seatbelt.v1";

const caseLiteral = (value: string): string =>
  Array.from(value)
    .map((character) =>
      /[a-z]/u.test(character)
        ? `[${character}${character.toUpperCase()}]`
        : character === "."
          ? "[.]"
          : character,
    )
    .join("");
const deniedCredentialPatterns = [
  `/${caseLiteral(".env")}([.][^/]*)?($|/)`,
  `/${caseLiteral(".pnpmfile")}[.][^/]+$`,
  `/(${[".git", ".ssh", ".aws", ".codex", ".claude"].map(caseLiteral).join("|")})(/|$)`,
  `/(${[".npmrc", ".netrc", "id_rsa", "id_ed25519"].map(caseLiteral).join("|")})$`,
  `[.](${["pem", "key", "p12", "pfx"].map(caseLiteral).join("|")})$`,
];

function path(value: string): string {
  if (
    !isAbsolute(value) ||
    value !== resolve(value) ||
    value === "/" ||
    value.length > 4096 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    Buffer.from(value).toString() !== value
  )
    throw new SiteBuildError("path");
  return JSON.stringify(value);
}

/**
 * Private host policy builder. Roots/executable/ports come from the trusted
 * registry and observed temporary directories, never from proposal JSON.
 * A profile string is not evidence that a child ran or that rendering passed.
 */
export function createSiteNodeSandboxPolicyV1(input: {
  sourceRoot: string;
  outputRoot: string;
  nodeExecutable: string;
  loopbackPorts: readonly number[];
  dependencyRoot?: string;
  denyFork?: boolean;
}): string {
  if (process.platform !== "darwin") throw new SiteBuildError("unavailable");
  const source = path(input.sourceRoot),
    output = path(input.outputRoot),
    node = path(input.nodeExecutable);
  const dependency =
    input.dependencyRoot === undefined ? "" : `(subpath ${path(input.dependencyRoot)})`;
  const ancestors = new Set<string>();
  for (const mounted of [
    input.sourceRoot,
    input.outputRoot,
    input.nodeExecutable,
    ...(input.dependencyRoot ? [input.dependencyRoot] : []),
  ]) {
    let parent = dirname(mounted);
    while (parent !== "/") {
      ancestors.add(parent);
      parent = dirname(parent);
    }
  }
  if (input.outputRoot === input.sourceRoot || input.sourceRoot.startsWith(`${input.outputRoot}/`))
    throw new SiteBuildError("path");
  if (
    input.outputRoot.startsWith(`${input.sourceRoot}/`) &&
    ![".next", ".nexpress/site/tmp", ".nexpress/site/review"].some(
      (relative) =>
        input.outputRoot === `${input.sourceRoot}/${relative}` ||
        input.outputRoot.startsWith(`${input.sourceRoot}/${relative}/`),
    )
  )
    throw new SiteBuildError("path");
  if (
    input.loopbackPorts.length > 4 ||
    new Set(input.loopbackPorts).size !== input.loopbackPorts.length ||
    input.loopbackPorts.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
  )
    throw new SiteBuildError("arguments");
  return `(version 1)
(deny default)
(deny file-link)
(allow process-exec (literal ${node}))
(allow process-info* (target self))
${input.denyFork ? "(deny process-fork)" : "(allow process-fork)"}
(allow sysctl-read)
; Resolve only observed mount/executable ancestors, without reading their data or children.
(allow file-read-metadata ${[...ancestors].map((value) => `(literal ${path(value)})`).join(" ")})
; Root-directory access is required by this host's Node/Rosetta startup.
; This literal does not grant read access to descendants.
(allow file-read* (literal "/")
  (subpath "/System/Library") (subpath "/System/Volumes/Preboot/Cryptexes/OS")
  (subpath "/usr/lib") (subpath "/usr/share/icu")
  (subpath "/Library/Apple") (subpath "/private/var/db/dyld")
  (subpath "/private/var/db/timezone")
  (literal "/dev/null") (literal "/dev/urandom")
  (literal ${node}) (subpath ${source}) (subpath ${output}) ${dependency})
(allow file-write* (subpath ${output}))
${deniedCredentialPatterns.map((pattern) => `(deny file-read* file-write* (regex #${JSON.stringify(pattern)}))`).join("\n")}
${input.loopbackPorts.map((port) => `(allow network-outbound (remote ip "localhost:${port}"))`).join("\n")}
`;
}

/** Fixed runtime base only. Synthetic DB/storage/session bindings belong to the owning registry. */
export function siteNodeSandboxEnvironmentV1(outputRoot: string): NodeJS.ProcessEnv {
  path(outputRoot);
  return { PATH: "/usr/bin:/bin", NODE_ENV: "test", TZ: "UTC", CI: "1", TMPDIR: outputRoot };
}
