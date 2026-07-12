import { DEFAULT_THEME } from "./defaults.js";
import type {
  NpThemeColors,
  NpThemeShape,
  NpThemeTokens,
  NpThemeTokensOverlay,
  NpThemeTypography,
} from "./types.js";

type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];

function defineExactKeys<T>() {
  return <const Keys extends readonly (keyof T)[]>(
    keys: Keys & (keyof T extends Keys[number] ? unknown : never),
  ): Keys => keys;
}

export const npThemeTokenGroups = defineExactKeys<NpThemeTokens>()([
  "colors",
  "typography",
  "shape",
]);

export type NpThemeTokenGroup = (typeof npThemeTokenGroups)[number];

const colorTokenKeys = defineExactKeys<NpThemeColors>()([
  "primary",
  "primaryForeground",
  "primarySoft",
  "background",
  "foreground",
  "muted",
  "mutedForeground",
  "border",
  "card",
  "cardForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
]);

const typographyTokenKeys = defineExactKeys<NpThemeTypography>()([
  "fontHeading",
  "fontBody",
  "fontMono",
  "fontSizeBase",
  "lineHeight",
  "fontSizeSm",
  "fontSizeLg",
  "fontSizeXl",
  "fontSize2xl",
  "fontSize3xl",
  "fontSize4xl",
]);

const shapeTokenKeys = defineExactKeys<NpThemeShape>()([
  "radiusSm",
  "radiusMd",
  "radiusLg",
  "radiusFull",
  "shadowSm",
  "shadowMd",
  "shadowLg",
]);

export const npThemeTokenKeys = {
  colors: colorTokenKeys,
  typography: typographyTokenKeys,
  shape: shapeTokenKeys,
} as const satisfies Record<NpThemeTokenGroup, readonly PropertyKey[]>;

export const npThemeOptionalTokenKeys = {
  colors: defineExactKeys<Pick<NpThemeColors, OptionalKeys<NpThemeColors>>>()(["primarySoft"]),
  typography: defineExactKeys<Pick<NpThemeTypography, OptionalKeys<NpThemeTypography>>>()([]),
  shape: defineExactKeys<Pick<NpThemeShape, OptionalKeys<NpThemeShape>>>()([]),
} as const satisfies Record<NpThemeTokenGroup, readonly PropertyKey[]>;

export interface NpThemeTokenContractIssue {
  readonly path: string;
  readonly message: string;
}

export type NpThemeTokenValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpThemeTokenContractIssue };

const tokenKeySets: Record<NpThemeTokenGroup, ReadonlySet<string>> = {
  colors: new Set(npThemeTokenKeys.colors),
  typography: new Set(npThemeTokenKeys.typography),
  shape: new Set(npThemeTokenKeys.shape),
};

const optionalTokenKeySets: Record<NpThemeTokenGroup, ReadonlySet<string>> = {
  colors: new Set(npThemeOptionalTokenKeys.colors),
  typography: new Set(npThemeOptionalTokenKeys.typography),
  shape: new Set(npThemeOptionalTokenKeys.shape),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function analyzeTokenValue(value: unknown, path: string): NpThemeTokenContractIssue | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return { path, message: "theme token values must be trimmed, non-empty strings." };
  }
  if (value.length > 200) {
    return { path, message: "theme token values must be at most 200 characters." };
  }
  const hasControlCharacter = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (
    hasControlCharacter ||
    /[;{}\\<>]/u.test(value) ||
    /\/\*|\*\/|url\s*\(|image-set\s*\(|src\s*\(|expression\s*\(|@import/iu.test(value)
  ) {
    return {
      path,
      message: "theme token values must not contain CSS statement or resource-loading syntax.",
    };
  }
  return null;
}

function analyzeThemeTokenObject(value: unknown, full: boolean): NpThemeTokenContractIssue[] {
  if (!isRecord(value)) {
    return [{ path: "theme", message: "theme tokens must be a plain object." }];
  }

  const issues: NpThemeTokenContractIssue[] = [];
  for (const group of Object.keys(value)) {
    if (!npThemeTokenGroups.includes(group as NpThemeTokenGroup)) {
      issues.push({ path: `theme.${group}`, message: `unsupported theme token group "${group}".` });
    }
  }

  for (const group of npThemeTokenGroups) {
    const rawGroup = value[group];
    if (rawGroup === undefined) {
      if (Object.hasOwn(value, group)) {
        issues.push({
          path: `theme.${group}`,
          message: "theme token groups must be plain objects.",
        });
      } else if (full) {
        issues.push({
          path: `theme.${group}`,
          message: `theme token group "${group}" is required.`,
        });
      }
      continue;
    }
    if (!isRecord(rawGroup)) {
      issues.push({ path: `theme.${group}`, message: "theme token groups must be plain objects." });
      continue;
    }

    for (const key of Object.keys(rawGroup)) {
      if (!tokenKeySets[group].has(key)) {
        issues.push({
          path: `theme.${group}.${key}`,
          message: `unsupported ${group} theme token "${key}".`,
        });
      }
    }

    for (const key of npThemeTokenKeys[group]) {
      const token = rawGroup[key];
      if (token === undefined && !Object.hasOwn(rawGroup, key)) {
        if (full && !optionalTokenKeySets[group].has(key)) {
          issues.push({
            path: `theme.${group}.${key}`,
            message: `theme token "${group}.${key}" is required.`,
          });
        }
        continue;
      }
      const tokenIssue = analyzeTokenValue(token, `theme.${group}.${key}`);
      if (tokenIssue) issues.push(tokenIssue);
    }
  }

  return issues;
}

export function npAnalyzeThemeTokens(value: unknown): NpThemeTokenContractIssue[] {
  return analyzeThemeTokenObject(value, true);
}

export function npAnalyzeThemeTokensOverlay(value: unknown): NpThemeTokenContractIssue[] {
  return analyzeThemeTokenObject(value, false);
}

export function npValidateThemeTokens(value: unknown): NpThemeTokenValidationResult {
  const issue = npAnalyzeThemeTokens(value)[0];
  return issue ? { ok: false, issue } : { ok: true };
}

export function npValidateThemeTokensOverlay(value: unknown): NpThemeTokenValidationResult {
  const issue = npAnalyzeThemeTokensOverlay(value)[0];
  return issue ? { ok: false, issue } : { ok: true };
}

export function isNpThemeTokens(value: unknown): value is NpThemeTokens {
  return npValidateThemeTokens(value).ok;
}

export function isNpThemeTokensOverlay(value: unknown): value is NpThemeTokensOverlay {
  return npValidateThemeTokensOverlay(value).ok;
}

/**
 * Layers validated partial token trees without replacing sibling keys.
 * Callers accepting `unknown` must run `npValidateThemeTokensOverlay` first.
 */
export function npMergeThemeTokens(
  base: NpThemeTokens = DEFAULT_THEME,
  ...overlays: ReadonlyArray<NpThemeTokensOverlay | undefined>
): NpThemeTokens {
  const result: NpThemeTokens = {
    colors: { ...base.colors },
    typography: { ...base.typography },
    shape: { ...base.shape },
  };
  for (const overlay of overlays) {
    if (!overlay) continue;
    if (overlay.colors) Object.assign(result.colors, overlay.colors);
    if (overlay.typography) Object.assign(result.typography, overlay.typography);
    if (overlay.shape) Object.assign(result.shape, overlay.shape);
  }
  return result;
}

/** Deeply combine persisted/admin/plugin overlays without materializing defaults. */
export function npMergeThemeTokenOverlays(
  ...overlays: ReadonlyArray<NpThemeTokensOverlay | undefined>
): NpThemeTokensOverlay {
  const result: NpThemeTokensOverlay = {};
  for (const overlay of overlays) {
    if (!overlay) continue;
    if (overlay.colors) result.colors = { ...result.colors, ...overlay.colors };
    if (overlay.typography) {
      result.typography = { ...result.typography, ...overlay.typography };
    }
    if (overlay.shape) result.shape = { ...result.shape, ...overlay.shape };
  }
  return result;
}
