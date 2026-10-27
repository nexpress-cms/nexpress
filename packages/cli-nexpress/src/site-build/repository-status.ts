import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { npIsBuildSourcePathExcludedV1 } from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";

/** Local status only. Disable external fsmonitor and ambient Git configuration. */
export async function observeSiteBuildDirtyPathsV1(project: string): Promise<string[]> {
  const cwd = await realpath(project);
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      "/usr/bin/git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ],
      {
        cwd,
        encoding: "buffer",
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, stdout) => (error ? reject(new SiteBuildError("unavailable")) : resolve(stdout)),
    );
  });
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text && !text.endsWith("\0")) throw new SiteBuildError("input");
  const fields = text ? text.slice(0, -1).split("\0") : [];
  const paths = new Set<string>();
  const add = (value: string) => {
    if (
      !value ||
      value.length > 512 ||
      value.startsWith("/") ||
      value.split("/").some((part) => !part || part === "." || part === "..") ||
      value.includes("\\") ||
      [...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new SiteBuildError("path");
    // Render/audit outputs and build caches are not repository source. A
    // scaffold need not amend .gitignore for its own prior review artifacts
    // to stop generation, while staged planning inputs remain protected.
    if (!npIsBuildSourcePathExcludedV1(value)) paths.add(value);
  };
  for (let index = 0; index < fields.length; index++) {
    const row = fields[index];
    if (!/^[ MADRCU?!]{2} /u.test(row)) throw new SiteBuildError("input");
    add(row.slice(3));
    // -z prints rename/copy destination first and the original as the next field.
    if (/[RC]/u.test(row.slice(0, 2))) add(fields[++index] ?? "");
  }
  if (paths.size > 10_000) throw new SiteBuildError("input");
  return [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}
