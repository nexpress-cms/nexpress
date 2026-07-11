import { describe, expect, it } from "vitest";

import { type CliIo, runCli } from "./cli.js";

const user = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "gettext-test@local",
  name: "Gettext Test",
  role: "admin" as const,
  tokenVersion: 0,
};

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out(message) {
        out.push(message);
      },
      err(message) {
        err.push(message);
      },
    },
    out,
    err,
  };
}

describe("Gettext CLI", () => {
  it("prints help without touching runtime services", async () => {
    const result = capture();
    expect(await runCli(result.io, ["--help"], { user })).toEqual({ exitCode: 0 });
    expect(result.out.join("")).toContain("gettext export");
  });

  it("rejects unknown commands", async () => {
    const result = capture();
    expect(await runCli(result.io, ["unknown"], { user })).toEqual({ exitCode: 2 });
    expect(result.err.join("")).toContain("Unknown command");
  });

  it("validates import flags before reading a file", async () => {
    const result = capture();
    expect(await runCli(result.io, ["import", "catalog.po", "--force"], { user })).toEqual({
      exitCode: 2,
    });
    expect(result.err.join("")).toContain("unknown flag --force");
  });
});
