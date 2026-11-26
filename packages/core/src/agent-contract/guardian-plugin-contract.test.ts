import { describe, expect, it, vi } from "vitest";
import { npPluginIdMaxLength, npPluginIdPattern } from "../plugins/id-contract.js";
import {
  npRequireAgentSecurityPluginChangePayloadV1,
  npRequireAgentSecurityPluginTransitionV1,
} from "./guardian-plugin-contract.js";
const id = "73111111-1111-4111-8111-111111111111",
  digest = `cj1:sha256:${"A".repeat(43)}`;
const commitment = (last = "A", keyId = "host-source-1") => ({
  keyId,
  mac: `hmac-sha256:${"A".repeat(42)}${last}`,
});
const activation = () => ({
  kind: "plugin-activation",
  pluginId: "@nexpress/oauth_github",
  previous: { enabled: true, commitment: commitment() },
  current: { enabled: false, commitment: commitment("E") },
});
const config = () => ({
  kind: "plugin-config",
  pluginId: "search",
  previous: { schemaVersion: 1, commitment: commitment() },
  current: { schemaVersion: 1, commitment: commitment("E") },
});
const payload = (transition: unknown) => ({
  kind: "security.plugin.changed",
  transitionId: id,
  sourceReceiptId: id,
  impact: { scope: "site", affectedSiteCount: 1, siteCatalogDigest: digest },
  transition,
});
describe("closed committed Guardian plugin transitions", () => {
  it("preserves only actual effective activation flips and same-key committed before/current states", () => {
    expect(npRequireAgentSecurityPluginChangePayloadV1(payload(activation()))).toEqual(
      payload(activation()),
    );
    const enabled = {
      ...activation(),
      previous: { enabled: false, commitment: commitment() },
      current: { enabled: true, commitment: commitment("E") },
    };
    expect(npRequireAgentSecurityPluginTransitionV1(enabled)).toEqual(enabled);
    for (const bad of [
      { ...activation(), current: { ...activation().current, enabled: true } },
      { ...activation(), current: { ...activation().current, commitment: commitment() } },
      {
        ...activation(),
        current: { ...activation().current, commitment: commitment("E", "new-key") },
      },
      { ...activation(), previous: null },
      { ...activation(), current: { ...activation().current, enabled: "false" } },
      { ...activation(), actorUserId: id },
      {
        ...activation(),
        previous: { ...activation().previous, updatedAt: "2026-10-18T00:00:00.000Z" },
      },
    ])
      expect(() => npRequireAgentSecurityPluginTransitionV1(bad)).toThrow();
  });
  it("distinguishes first config persistence, changed config and schema changes without carrying config fields or unkeyed hashes", () => {
    const values = [
      config(),
      { ...config(), previous: null },
      { ...config(), current: { ...config().current, schemaVersion: 2 } },
      {
        ...config(),
        previous: { ...config().previous, schemaVersion: 2 },
        current: { ...config().current, schemaVersion: 1 },
      },
    ];
    for (const value of values)
      expect(npRequireAgentSecurityPluginTransitionV1(value)).toEqual(value);
    for (const bad of [
      { ...config(), config: { apiKey: "private-config-marker" } },
      { ...config(), current: { schemaVersion: 1, hash: digest } },
      { ...config(), current: { ...config().current, commitment: commitment() } },
      {
        ...config(),
        current: { ...config().current, commitment: commitment("E", "rotated-only") },
      },
      { ...config(), current: { ...config().current, schemaVersion: 0 } },
      { ...config(), current: { ...config().current, schemaVersion: 1.5 } },
      { ...config(), previous: { ...config().previous, rawConfig: { secret: "marker" } } },
      { ...config(), kind: "plugin-reload" },
    ])
      expect(() => npRequireAgentSecurityPluginTransitionV1(bad)).toThrow();
  });
  it("enforces exact site impact and source receipt shape", () => {
    for (const bad of [
      {
        ...payload(config()),
        impact: { scope: "deployment", affectedSiteCount: 3, siteCatalogDigest: digest },
      },
      {
        ...payload(config()),
        impact: { scope: "site", affectedSiteCount: 2, siteCatalogDigest: digest },
      },
      { ...payload(config()), sourceReceiptId: "unknown" },
      { ...payload(config()), kind: "plugin.changed" },
      { ...payload(config()), configuration: {} },
    ])
      expect(() => npRequireAgentSecurityPluginChangePayloadV1(bad)).toThrow();
  });
  it("preserves the existing scoped and unscoped npm plugin identifier grammar", () => {
    for (const pluginId of [
      "search",
      "GitHub_OAuth",
      "@nexpress/oauth_github",
      "a".repeat(128),
      "",
      "@scope/",
      "../plugin",
      "plugin/path",
      "@scope/a/b",
      "x".repeat(129),
    ]) {
      const valid =
        pluginId.length > 0 &&
        pluginId.length <= npPluginIdMaxLength &&
        new RegExp(npPluginIdPattern, "u").test(pluginId);
      if (valid)
        expect(npRequireAgentSecurityPluginTransitionV1({ ...config(), pluginId }).pluginId).toBe(
          pluginId,
        );
      else
        expect(() => npRequireAgentSecurityPluginTransitionV1({ ...config(), pluginId })).toThrow();
    }
  });
  it("does not execute getters and returns independent fact projections", () => {
    const getter = vi.fn(() => ({ apiKey: "private" })),
      input = config();
    Object.defineProperty(input, "config", { enumerable: true, get: getter });
    expect(() => npRequireAgentSecurityPluginTransitionV1(input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const value = config(),
      result = npRequireAgentSecurityPluginTransitionV1(value);
    value.current.commitment.mac = commitment().mac;
    expect(result.current.commitment).toEqual(commitment("E"));
  });
});
