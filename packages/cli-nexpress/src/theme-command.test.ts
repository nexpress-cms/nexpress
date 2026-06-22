import { afterEach, describe, expect, it, vi } from "vitest";

import { runNexpressCli } from "./index.js";

function captureStdout() {
  let output = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    output += String(chunk);
    return true;
  });
  return {
    read: () => output,
    restore: () => spy.mockRestore(),
  };
}

function captureStderr() {
  let output = "";
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    output += String(chunk);
    return true;
  });
  return {
    read: () => output,
    restore: () => spy.mockRestore(),
  };
}

describe("theme commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists theme remove as the primary uninstall command", async () => {
    const stdout = captureStdout();

    const code = await runNexpressCli(["node", "nexpress", "--help"]);

    stdout.restore();
    expect(code).toBe(0);
    expect(stdout.read()).toContain("nexpress theme remove <package>");
    expect(stdout.read()).toContain("nexpress theme:uninstall <package>");
    expect(stdout.read()).toContain("Legacy alias for theme remove");
  });

  it("parses theme remove errors before reaching the uninstall runner", async () => {
    const stderr = captureStderr();

    const code = await runNexpressCli(["node", "nexpress", "theme", "remove", "--force"]);

    stderr.restore();
    expect(code).toBe(2);
    expect(stderr.read()).toContain("Unknown flag for theme remove: --force");
  });
});
