import { describe, expect, it } from "vitest";

import {
  formatPluginManualConfigGuidance,
  formatPluginManualRemoveGuidance,
  formatPluginPostInstallGuidance,
  formatPluginPostRemoveGuidance,
  formatProjectScriptCommand,
  pluginAddCommand,
  pluginRemoveCommand,
} from "./plugin-guidance.js";

describe("plugin install guidance", () => {
  it("formats project script commands for the detected package manager", () => {
    expect(formatProjectScriptCommand("pnpm", "ops:plugins", ["doctor", "--json"])).toBe(
      "pnpm --silent run ops:plugins -- doctor --json",
    );
    expect(formatProjectScriptCommand("npm", "ops:plugins", ["doctor", "--json"])).toBe(
      "npm --silent run ops:plugins -- doctor --json",
    );
    expect(formatProjectScriptCommand("yarn", "ops:plugins", ["doctor", "--json"])).toBe(
      "yarn ops:plugins doctor --json",
    );
  });

  it("formats plugin add commands for manual recovery", () => {
    expect(pluginAddCommand("pnpm", "@acme/plugin-demo")).toBe(
      "pnpm exec nexpress plugin add @acme/plugin-demo",
    );
    expect(pluginAddCommand("npm", "@acme/plugin-demo")).toBe(
      "npx nexpress plugin add @acme/plugin-demo",
    );
    expect(pluginAddCommand("yarn", "@acme/plugin-demo")).toBe(
      "yarn nexpress plugin add @acme/plugin-demo",
    );
  });

  it("formats plugin remove commands for manual recovery", () => {
    expect(pluginRemoveCommand("pnpm", "@acme/plugin-demo")).toBe(
      "pnpm exec nexpress plugin remove @acme/plugin-demo",
    );
    expect(pluginRemoveCommand("npm", "@acme/plugin-demo")).toBe(
      "npx nexpress plugin remove @acme/plugin-demo",
    );
    expect(pluginRemoveCommand("yarn", "@acme/plugin-demo")).toBe(
      "yarn nexpress plugin remove @acme/plugin-demo",
    );
  });

  it("keeps successful installs connected to restart and doctor verification", () => {
    const guidance = formatPluginPostInstallGuidance("pnpm");

    expect(guidance).toContain("Restart your dev server or redeploy");
    expect(guidance).toContain("pnpm --silent run ops:plugins -- doctor --json");
    expect(guidance).toContain("pnpm --silent run ops:plugins -- list --json");
  });

  it("keeps successful removals connected to restart and doctor verification", () => {
    const guidance = formatPluginPostRemoveGuidance("pnpm");

    expect(guidance).toContain("boot-time plugin code unloads");
    expect(guidance).toContain("pnpm --silent run ops:plugins -- doctor --json");
    expect(guidance).toContain("pnpm --silent run ops:plugins -- list --json");
  });

  it("gives marker-recovery steps before verification", () => {
    const guidance = formatPluginManualConfigGuidance({
      manager: "pnpm",
      packageName: "my-plugin",
    });

    expect(guidance).toContain("Add the marker block");
    expect(guidance).toContain("pnpm exec nexpress plugin add my-plugin");
    expect(guidance).toContain("pnpm --silent run ops:plugins -- doctor --json");
  });

  it("gives manual remove steps before verification", () => {
    const guidance = formatPluginManualRemoveGuidance({
      manager: "pnpm",
      packageName: "my-plugin",
    });

    expect(guidance).toContain("Remove the config snippet");
    expect(guidance).toContain("pnpm exec nexpress plugin remove my-plugin");
    expect(guidance).toContain("pnpm --silent run ops:plugins -- doctor --json");
  });
});
