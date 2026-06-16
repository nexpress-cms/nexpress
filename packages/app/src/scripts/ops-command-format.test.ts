import { describe, expect, it } from "vitest";

import { isMatchingProjectCommand, toProjectCommand } from "./ops-command-format.js";

describe("ops command formatting", () => {
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
});
