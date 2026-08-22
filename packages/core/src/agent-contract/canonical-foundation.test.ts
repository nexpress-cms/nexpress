import { describe, expect, it, vi } from "vitest";

import { NpAgentContractError } from "./contract.js";
import {
  analyzeAgentCanonicalJsonValue,
  analyzeAgentCanonicalJsonValueWithLimits,
  buildAgentCanonicalFoundationBytes,
  serializeAgentCanonicalJson,
} from "./canonical-foundation.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCanonicalHmacOwnersV1,
  npAgentCanonicalPurposes,
  type NpAgentCanonicalHmacPurposeV1,
  type NpAgentCanonicalShaPurposeV1,
} from "./types.js";

const decoder = new TextDecoder();

describe("Agent canonical JSON foundation", () => {
  it("locks the exhaustive purpose, size, and HMAC owner inventories", () => {
    expect(npAgentCanonicalPurposes).toHaveLength(32);
    expect(new Set(npAgentCanonicalPurposes).size).toBe(npAgentCanonicalPurposes.length);
    expect([...npAgentCanonicalPurposes].sort()).toEqual(npAgentCanonicalPurposes);
    expect(Object.keys(npAgentCanonicalBodyMaxBytesV1)).toEqual(npAgentCanonicalPurposes);
    expect(Object.keys(npAgentCanonicalHmacOwnersV1).sort()).toEqual([
      "np.agent-approval-decision.v1",
      "np.agent-approval-revocation.v1",
      "np.agent-approval-statement.v1",
      "np.agent-connection-destination.v1",
    ]);

    const shaPurpose: NpAgentCanonicalShaPurposeV1 = "np.agent-action.v1";
    const hmacPurpose: NpAgentCanonicalHmacPurposeV1 = "np.agent-connection-destination.v1";
    expect([shaPurpose, hmacPurpose]).toEqual([
      "np.agent-action.v1",
      "np.agent-connection-destination.v1",
    ]);
  });

  it("matches the RFC 8785 serialization sample", () => {
    expect(
      serializeAgentCanonicalJson({
        numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27],
        string: '€$\u000f\nA\'B"\\\\"/',
        literals: [null, true, false],
      }),
    ).toBe(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
    );
  });

  it("sorts object keys by RFC 8785 UTF-16 code units", () => {
    expect(
      serializeAgentCanonicalJson({
        "€": "Euro Sign",
        "\r": "Carriage Return",
        דּ: "Hebrew Letter Dalet With Dagesh",
        "1": "One",
        "😀": "Emoji: Grinning Face",
        "\u0080": "Control",
        ö: "Latin Small Letter O With Diaeresis",
      }),
    ).toBe(
      String.raw`{"\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}`,
    );
  });

  it("is independent of source key insertion order without normalizing Unicode", () => {
    expect(serializeAgentCanonicalJson({ z: 1, nested: { z: 2, a: 1 }, a: 2 })).toBe(
      serializeAgentCanonicalJson({ a: 2, nested: { a: 1, z: 2 }, z: 1 }),
    );
    expect(serializeAgentCanonicalJson({ value: "é" })).not.toBe(
      serializeAgentCanonicalJson({ value: "e\u0301" }),
    );
  });

  it("normalizes negative zero and rejects non-finite numbers and lone surrogates", () => {
    expect(serializeAgentCanonicalJson({ value: -0 })).toBe('{"value":0}');
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(analyzeAgentCanonicalJsonValue({ value })).toMatchObject({
        ok: false,
        issues: [{ code: "unsafe-value" }],
      });
    }
    expect(analyzeAgentCanonicalJsonValue({ value: "\ud800" })).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("builds BOM-free, exactly domain-separated UTF-8 bytes and safe body copies", () => {
    const source = { z: "last", a: "first" };
    const built = buildAgentCanonicalFoundationBytes("np.agent-action.v1", source);
    const canonical = '{"a":"first","z":"last"}';
    const prefix = "np.agent-canonical-json.v1\0np.agent-action.v1\0";

    expect(built.purpose).toBe("np.agent-action.v1");
    expect(built.body).toEqual(source);
    expect(built.body).not.toBe(source);
    expect(decoder.decode(built.canonicalJsonUtf8)).toBe(canonical);
    expect(decoder.decode(built.domainSeparatedUtf8)).toBe(`${prefix}${canonical}`);
    expect([...built.canonicalJsonUtf8.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it("enforces the selected purpose byte ceiling before domain separation", () => {
    const maximum = npAgentCanonicalBodyMaxBytesV1["np.agent-run-limits.v1"];
    const exact = buildAgentCanonicalFoundationBytes("np.agent-run-limits.v1", {
      x: "a".repeat(maximum - 8),
    });
    expect(exact.canonicalJsonUtf8).toHaveLength(maximum);
    expect(() =>
      buildAgentCanonicalFoundationBytes("np.agent-run-limits.v1", {
        x: "a".repeat(maximum - 7),
      }),
    ).toThrow(NpAgentContractError);
  });

  it("enforces injected canonical UTF-8 byte limits before serialization", () => {
    const source = { "\n": "😀", value: "é" };
    const bytes = new TextEncoder().encode(serializeAgentCanonicalJson(source)).byteLength;
    const limits = {
      maximumDepth: 8,
      maximumNodes: 32,
      maximumArrayItems: 8,
      maximumObjectProperties: 8,
      maximumStringCharacters: 32,
      maximumCanonicalBytes: bytes,
    };

    expect(analyzeAgentCanonicalJsonValueWithLimits(source, "fixture", limits)).toMatchObject({
      ok: true,
      value: source,
    });
    expect(
      analyzeAgentCanonicalJsonValueWithLimits(source, "fixture", {
        ...limits,
        maximumCanonicalBytes: bytes - 1,
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "limit" }] });
  });

  it("rejects cycles, shared references, sparse arrays, and non-data properties", () => {
    const shared = { value: true };
    expect(analyzeAgentCanonicalJsonValue({ first: shared, second: shared })).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(analyzeAgentCanonicalJsonValue(cycle)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    expect(analyzeAgentCanonicalJsonValue({ values: Array(1) })).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const hidden = { visible: true };
    Object.defineProperty(hidden, "secret", { value: "hidden", enumerable: false });
    expect(analyzeAgentCanonicalJsonValue(hidden)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });
  });

  it("does not invoke accessors and contains hostile reflection failures", () => {
    const getter = vi.fn(() => "secret");
    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: getter });
    expect(analyzeAgentCanonicalJsonValue(accessor)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });
    expect(getter).not.toHaveBeenCalled();

    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("contained");
        },
      },
    );
    expect(analyzeAgentCanonicalJsonValue(hostile)).toEqual({
      ok: false,
      issues: [
        {
          code: "unsafe-value",
          path: "agent.canonical",
          message: "could not be inspected safely",
        },
      ],
    });
  });

  it("copies special JSON keys without prototype mutation", () => {
    const source = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    const built = buildAgentCanonicalFoundationBytes("np.agent-event.v1", source);
    expect(Object.hasOwn(built.body, "__proto__")).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(decoder.decode(built.canonicalJsonUtf8)).toBe('{"__proto__":{"polluted":true}}');
  });

  it("rejects runtime purpose strings outside the closed registry", () => {
    expect(() =>
      buildAgentCanonicalFoundationBytes("np.agent-unknown.v1" as "np.agent-action.v1", {}),
    ).toThrow(NpAgentContractError);
  });
});
