import { describe, expect, it } from "vitest";

import {
  isMatchingProjectCommand,
  normalizePnpmPassthroughArgv,
  readCommandOption,
  toProjectCommand,
} from "./ops-command-format.js";

describe("ops command formatting", () => {
  it("reads the first exact option while leaving empty and flag-like values to the command", () => {
    const cases: [string[], string | null][] = [
      [[], null],
      [["--out"], null],
      [["--output=file.json"], null],
      [["--out", "a b.json"], "a b.json"],
      [["--out=a=b.json"], "a=b.json"],
      [["--out="], ""],
      [["--out", ""], ""],
      [["--out", "--json"], "--json"],
      [["--out=first", "--out", "second"], "first"],
      [["--out", "first", "--out=second"], "first"],
    ];
    for (const [argv, value] of cases) {
      expect(readCommandOption(argv, "--out"), JSON.stringify(argv)).toBe(value);
    }
    expect(readCommandOption(["--url=https://example.test/path?a=b"], "--url")).toBe(
      "https://example.test/path?a=b",
    );
  });

  it("uses silent pnpm for JSON project commands", () => {
    expect(toProjectCommand("nexpress release check --target vercel --json")).toBe(
      "pnpm --silent run ops:release -- check --target vercel --json",
    );
    expect(toProjectCommand("nexpress ops storage verify --json")).toBe(
      "pnpm --silent run ops:storage -- verify --json",
    );
    expect(toProjectCommand("nexpress runbook migration-crashed --json")).toBe(
      "pnpm --silent run ops:runbook -- migration-crashed --json",
    );
  });

  it("keeps human-readable project commands unchanged", () => {
    expect(toProjectCommand("nexpress ops preflight --target vercel --brief --no-color")).toBe(
      "pnpm run ops:preflight -- --target vercel --brief --no-color",
    );
  });

  it("accepts legacy non-silent project commands for existing artifacts", () => {
    expect(
      isMatchingProjectCommand(
        "nexpress release verify --json",
        "pnpm --silent run ops:release -- verify --json",
      ),
    ).toBe(true);
    expect(
      isMatchingProjectCommand(
        "nexpress release verify --json",
        "pnpm --silent run ops:release -- verify --json",
      ),
    ).toBe(true);
  });

  it("normalizes pnpm passthrough separators before subcommand parsing", () => {
    expect(normalizePnpmPassthroughArgv(["--", "migrate", "plan", "--json"])).toEqual([
      "migrate",
      "plan",
      "--json",
    ]);
    expect(normalizePnpmPassthroughArgv(["verify", "--json"])).toEqual(["verify", "--json"]);
  });
});
