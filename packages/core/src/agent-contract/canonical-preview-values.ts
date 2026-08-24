import { npI18nContractLimits, npRequireLocale } from "../i18n-contract/index.js";
import { failCanonicalBody } from "./canonical-body-validation.js";

const MAXIMUM_ORIGIN_CHARACTERS = 2_048;

function hasUnsafeRouteCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (
      code === undefined ||
      code <= 0x20 ||
      code === 0x7f ||
      character === "\\" ||
      character === "?" ||
      character === "#"
    ) {
      return true;
    }
  }
  return false;
}

export function canonicalBodyPreviewRoute(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npI18nContractLimits.pathnameLength ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasUnsafeRouteCharacter(value)
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      "must be one bounded absolute site-relative path without origin, query, or fragment",
    );
  }
  if (value !== "/" && (value.endsWith("/") || value.includes("//"))) {
    failCanonicalBody("invalid-field", path, "must not contain empty or trailing path segments");
  }
  const segments = value === "/" ? [] : value.slice(1).split("/");
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      failCanonicalBody("invalid-field", path, "must contain valid path encoding");
    }
    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      failCanonicalBody("invalid-field", path, "must not contain empty or dot path segments");
    }
  }
  return value;
}

export function canonicalBodyPreviewLocale(value: unknown, path: string): string {
  try {
    return npRequireLocale(value, path);
  } catch {
    failCanonicalBody("invalid-field", path, "must be a canonical BCP 47 locale");
  }
}

export function canonicalBodyQuerylessHttpsOrigin(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAXIMUM_ORIGIN_CHARACTERS) {
    failCanonicalBody("invalid-field", path, "must be one bounded canonical HTTPS origin");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    failCanonicalBody("invalid-field", path, "must be one bounded canonical HTTPS origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== value
  ) {
    failCanonicalBody("invalid-field", path, "must be one canonical queryless HTTPS origin");
  }
  return value;
}

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}
