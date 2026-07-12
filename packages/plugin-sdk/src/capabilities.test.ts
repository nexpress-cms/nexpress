import { describe, expect, it } from "vitest";

import { npCapabilityToCtxMembers, npHookNames, npPluginCapabilities } from "./types.js";

describe("npPluginCapabilities", () => {
  it("includes a hooks:<namespace> entry for every hook name namespace", () => {
    // Every hook name has the form `<namespace>:<event>`. The host derives
    // the required capability as `hooks:<namespace>`. A plugin can't declare
    // a capability that isn't in the enum, so the enum must cover every
    // namespace used by `npHookNames` — otherwise the plugin literally
    // cannot register that hook (manifest validation would reject the
    // capability string). This test enforces the round-trip.
    const namespaces = new Set<string>();
    for (const hookName of npHookNames) {
      const ns = hookName.split(":")[0];
      if (ns) namespaces.add(ns);
    }
    for (const ns of namespaces) {
      const required = `hooks:${ns}` as const;
      expect(npPluginCapabilities).toContain(required);
    }
  });
});

describe("npCapabilityToCtxMembers", () => {
  it("has an entry for every declared capability", () => {
    for (const cap of npPluginCapabilities) {
      expect(npCapabilityToCtxMembers[cap]).toBeDefined();
    }
  });

  it("does not list unknown capabilities", () => {
    for (const cap of Object.keys(npCapabilityToCtxMembers)) {
      expect(npPluginCapabilities).toContain(cap);
    }
  });

  it("maps plugin settings reads and writes to their enforced capabilities", () => {
    expect(npCapabilityToCtxMembers["settings:read"]).toEqual([
      "settings.getSite",
      "settings.getPlugin",
    ]);
    expect(npCapabilityToCtxMembers["settings:write"]).toEqual(["settings.setPlugin"]);
  });
});
