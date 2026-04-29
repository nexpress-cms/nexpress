import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type CliIo, runCli } from "./index.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);

function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    },
  };
}

describe("runCli", () => {
  it("prints the dry-run summary and exits 0 for a valid WXR file", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli([path.join(FIXTURES_DIR, "minimal.wxr.xml")], io);
    expect(code).toBe(0);
    expect(err).toHaveLength(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("WordPress import — dry run");
    expect(out[0]).toContain("Acme Test Blog");
    expect(out[0]).toContain("Records (3)");
  });

  it("exits 2 with usage help when no path is given", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli([], io);
    expect(code).toBe(2);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("missing path");
    expect(err.join("\n")).toContain("Usage:");
  });

  it("exits 0 and prints usage for --help", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli(["--help"], io);
    expect(code).toBe(0);
    expect(err).toHaveLength(0);
    expect(out.join("\n")).toContain("Usage:");
  });

  it("exits 1 with a clear error when the path doesn't exist", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli(["/nope/does-not-exist.xml"], io);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("cannot read");
  });

  it("exits 2 on unknown flag with a usage hint", async () => {
    const { io, out: _out, err } = captureIo();
    const code = await runCli(["--bogus"], io);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("Usage:");
  });
});
