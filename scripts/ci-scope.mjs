import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const rootDocs = new Set(["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "AGENTS.md"]);

export function classifyDiff(raw) {
  const parts = raw.split("\0");
  if (parts.pop() !== "" || parts.length === 0 || parts.length % 2) return null;
  const files = [];
  for (let i = 0; i < parts.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) [a-f0-9]+ [a-f0-9]+ ([AMD])$/.exec(parts[i]);
    const path = parts[i + 1];
    if (
      !match ||
      !["000000", "100644"].includes(match[1]) ||
      !["000000", "100644"].includes(match[2]) ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      !(rootDocs.has(path) || (path.startsWith("docs/") && path.endsWith(".md")))
    )
      return null;
    if (match[3] !== "D") files.push(path);
  }
  return files;
}

export function detectScope(
  eventName,
  event,
  git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
) {
  if (eventName !== "pull_request") return null;
  const base = event.pull_request?.base?.sha;
  const head = event.pull_request?.head?.sha;
  if (![base, head].every((sha) => typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha)))
    return null;
  try {
    const ancestor = git("merge-base", "--all", base, head).trim();
    if (!/^[a-f0-9]{40}$/.test(ancestor)) return null;
    return classifyDiff(git("diff", "--raw", "-z", "--no-renames", ancestor, head, "--"));
  } catch {
    return null; // Missing history or unreadable diff must never bypass full CI.
  }
}

export function requireGate(scopeResult, docsOnly, fullResult) {
  if (scopeResult !== "success")
    throw new Error("Change classification/document validation did not succeed");
  if (docsOnly === "true") {
    if (fullResult !== "skipped")
      throw new Error("Unexpected full-job result for documentation scope");
    return "Documentation validated; application checks intentionally not run.";
  }
  if (docsOnly !== "false" || fullResult !== "success")
    throw new Error("Required full CI job did not succeed");
  return "Full CI job succeeded.";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === "gate") {
    console.log(
      requireGate(process.env.SCOPE_RESULT, process.env.DOCS_ONLY, process.env.FULL_RESULT),
    );
  } else if (mode === "format") {
    const files = JSON.parse(readFileSync(process.argv[3], "utf8"));
    // Paths are argument-array entries, never interpolated into shell code.
    if (files.length) {
      const result = spawnSync("pnpm", ["exec", "prettier", "--check", "--", ...files], {
        stdio: "inherit",
      });
      if (result.error || result.status !== 0) process.exit(1);
    }
  } else {
    let files = null;
    try {
      files = detectScope(
        process.env.GITHUB_EVENT_NAME,
        JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
      );
    } catch {
      /* Full CI on invalid payload. */
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${files !== null}\n`);
    writeFileSync(process.argv[2], JSON.stringify(files ?? []));
    console.log(
      files === null
        ? "Full CI required."
        : "Documentation-only PR: validate retained Markdown files.",
    );
  }
}
