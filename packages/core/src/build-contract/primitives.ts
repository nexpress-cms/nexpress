import { z } from "zod";
import { analyzeAgentCanonicalJsonValueWithLimits } from "../agent-contract/canonical-foundation.js";
import { npAgentContractLimits, NpAgentContractError } from "../agent-contract/contract.js";
import type { NpAgentJsonObject, NpAgentJsonValue } from "../agent-contract/types.js";

export const encoder = new TextEncoder();
const hasControl = (value: string, multiline = false): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && !(multiline && [9, 10, 13].includes(code))) || code === 127;
  });
export const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v === v.trim() && !hasControl(v, true), "must be trimmed safe text");
export const id = text(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const label = text(120);
export const prose = text(4_000);
export const digest = z.string().regex(/^nb1:sha256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
export const fileDigest = z
  .string()
  .regex(/^nb1:file-sha256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
// These fingerprints retain their existing owner's encoding; live catalog comparison is separate.
export const fingerprint = text(512).regex(/^[A-Za-z0-9][A-Za-z0-9:._/@+-]*$/u);
export const slug = text(63).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
export const environmentName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
export const locale = text(35).refine((value) => {
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}, "must be a canonical locale");
export const httpsUrl = text(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.href === value;
  } catch {
    return false;
  }
}, "must be a canonical HTTPS citation without credentials");

export const npBuildSourceExcludedRootsV1 = Object.freeze([
  ".git",
  ".nexpress/site/review",
  ".nexpress/site/tmp",
  ".nexpress/site/audit",
] as const);
export const npBuildSourceExcludedDirectoryNamesV1 = Object.freeze([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
] as const);
export function npIsBuildSourcePathExcludedV1(path: string): boolean {
  return (
    npBuildSourceExcludedRootsV1.some((root) => path === root || path.startsWith(`${root}/`)) ||
    path
      .split("/")
      .slice(0, -1)
      .some((part) => (npBuildSourceExcludedDirectoryNamesV1 as readonly string[]).includes(part))
  );
}
export const relativePath = text(512).refine((value) => {
  const parts = value.split("/");
  return (
    !/[\\\s:*?"<>|%]/u.test(value) &&
    !hasControl(value) &&
    parts.every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        !/[. ]$/u.test(part) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  );
}, "must be a portable relative POSIX path");
const hasCredentialSegment = (value: string): boolean =>
  value
    .split("/")
    .some((part) =>
      /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.aws|\.ssh|\.pnpmfile\..*|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(
        part,
      ),
    );
export const sourcePath = relativePath.refine(
  (value) =>
    !npIsBuildSourcePathExcludedV1(value.toLowerCase()) &&
    !value.toLowerCase().startsWith(".nexpress/") &&
    !hasCredentialSegment(value),
  "must not address reserved outputs or credential files",
);
export const under = (root: string) =>
  relativePath.refine(
    (value) => value.startsWith(`${root}/`) && !hasCredentialSegment(value),
    `must be below ${root} without credential files`,
  );
export const route = text(512).refine((value) => {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s?#%]/u.test(value) ||
    hasControl(value)
  )
    return false;
  const parts = value.slice(1).split("/");
  return (
    value === "/" ||
    (!value.endsWith("/") &&
      parts.every((part) => part !== "" && part !== "." && part !== "..") &&
      !["admin", "api", "_next", ".nexpress"].includes(parts[0] ?? ""))
  );
}, "must be a canonical public/member route");
export const unique = <T>(
  schema: z.ZodType<T>,
  max: number,
  key: (value: T) => string = (value) => String(value),
) =>
  z
    .array(schema)
    .max(max)
    .refine(
      (items) => new Set(items.map(key)).size === items.length,
      "must have unique domain keys",
    );
export const strings = (max: number, chars = 500) => unique(text(chars), max);
export const compareUtf8 = (a: string, b: string): number => {
  const left = encoder.encode(a),
    right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
};
export const sortedIds = (max: number) =>
  unique(id, max).refine(
    (items) => items.every((v, i) => i === 0 || compareUtf8(items[i - 1], v) < 0),
    "must be sorted by UTF-8 bytes",
  );

export function fail(path: string, message: string): never {
  throw new NpAgentContractError("Invalid Build contract", [
    { code: "invalid-field", path, message },
  ]);
}
export function inspectJson(value: unknown, bytes: number, depth: number): NpAgentJsonValue {
  const result = analyzeAgentCanonicalJsonValueWithLimits(value, "build", {
    maximumDepth: depth,
    maximumNodes: 100_000,
    maximumArrayItems: 10_000,
    maximumObjectProperties: 1_024,
    maximumStringCharacters: 512 * 1024,
    maximumCanonicalBytes: bytes,
  });
  if (!result.ok) throw new NpAgentContractError("Invalid Build JSON", result.issues);
  const check = (v: NpAgentJsonValue): void => {
    if (typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v))
      fail("build", "must not contain unsafe integers");
    if (v && typeof v === "object") for (const child of Object.values(v)) check(child);
  };
  check(result.value);
  return result.value;
}
export function serializeJson(value: NpAgentJsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serializeJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeJson(value[key])}`)
    .join(",")}}`;
}
export const jsonObject: z.ZodType<NpAgentJsonObject> = z.custom<NpAgentJsonObject>((value) => {
  try {
    const result = analyzeAgentCanonicalJsonValueWithLimits(value, "build.data", {
      maximumDepth: npAgentContractLimits.invocationDepth,
      maximumNodes: npAgentContractLimits.invocationNodes,
      maximumArrayItems: npAgentContractLimits.invocationArrayItems,
      maximumObjectProperties: npAgentContractLimits.invocationObjectProperties,
      maximumStringCharacters: npAgentContractLimits.invocationStringCharacters,
      maximumCanonicalBytes: npAgentContractLimits.invocationBytes,
    });
    return (
      result.ok &&
      result.value !== null &&
      typeof result.value === "object" &&
      !Array.isArray(result.value)
    );
  } catch {
    return false;
  }
}, "must be a bounded JSON object");

/** Raw text must pass here before JSON.parse can discard duplicate (including escaped) keys. */
export function npParseBuildJsonV1(raw: string): NpAgentJsonValue {
  return parseBuildJsonWithLimits(raw, 4 * 1024 * 1024, 16);
}

/** Candidate transport envelopes contain a catalog and a complete direction draft.
 * Parsing only preserves strict JSON before their owning validators run; this
 * neither authenticates a native producer nor adds a canonical-purpose body.
 */
export function npParseBuildCandidateTransportJsonV1(raw: string): NpAgentJsonValue {
  return parseBuildJsonWithLimits(raw, 8 * 1024 * 1024, 24);
}

/** Internal owning profiles choose fixed bounds; callers cannot widen public artifact limits. */
export function parseBuildJsonWithLimits(
  raw: string,
  maximumBytes: number,
  maximumDepth: number,
): NpAgentJsonValue {
  if (
    typeof raw !== "string" ||
    raw.length > maximumBytes ||
    encoder.encode(raw).length > maximumBytes
  )
    fail("build.json", "exceeds raw JSON limit");
  let index = 0,
    nodes = 0;
  const space = () => {
    while (/[\t\r\n ]/u.test(raw[index] ?? "x")) index++;
  };
  const string = (): string => {
    const start = index++;
    while (index < raw.length) {
      const ch = raw[index++];
      if (ch === "\\") {
        index++;
        continue;
      }
      if (ch === '"') return JSON.parse(raw.slice(start, index)) as string;
    }
    return fail("build.json", "unterminated JSON string");
  };
  const scan = (depth: number): void => {
    if (depth > maximumDepth || ++nodes > 100_000)
      fail("build.json", "exceeds raw JSON depth/node limit");
    space();
    const ch = raw[index];
    if (ch === "{" || ch === "[") {
      const object = ch === "{",
        end = object ? "}" : "]",
        keys = new Set<string>();
      index++;
      space();
      if (raw[index] === end) {
        index++;
        return;
      }
      while (index < raw.length) {
        if (object) {
          if (raw[index] !== '"') fail("build.json", "expected JSON property");
          const key = string();
          if (keys.has(key)) fail("build.json", "duplicate JSON property");
          keys.add(key);
          space();
          if (raw[index++] !== ":") fail("build.json", "expected colon");
        }
        scan(depth + 1);
        space();
        const next = raw[index++];
        if (next === end) return;
        if (next !== ",") fail("build.json", "expected comma");
        space();
      }
      fail("build.json", "unterminated JSON container");
    }
    if (ch === '"') {
      string();
      return;
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(
      raw.slice(index),
    )?.[0];
    if (!token) fail("build.json", "invalid JSON token");
    index += token.length;
  };
  try {
    scan(0);
    space();
    if (index !== raw.length) fail("build.json", "unexpected trailing JSON");
    return inspectJson(JSON.parse(raw) as unknown, maximumBytes, maximumDepth);
  } catch (error) {
    if (error instanceof NpAgentContractError) throw error;
    return fail("build.json", "invalid JSON syntax");
  }
}
