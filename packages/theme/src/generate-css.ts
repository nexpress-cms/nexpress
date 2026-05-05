import { sanitizeTokenValue } from "@nexpress/core";
import type {
  NpThemeColors,
  NpThemeShape,
  NpThemeTokens,
  NpThemeTypography,
} from "@nexpress/core";

type ThemeColorKey = Extract<keyof NpThemeColors, string>;
type ThemeTypographyKey = Extract<keyof NpThemeTypography, string>;
type ThemeShapeKey = Extract<keyof NpThemeShape, string>;

const COLOR_KEYS: ThemeColorKey[] = [
  "primary",
  "primaryForeground",
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
];

const TYPOGRAPHY_KEYS: ThemeTypographyKey[] = [
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
];

const SHAPE_KEYS: ThemeShapeKey[] = [
  "radiusSm",
  "radiusMd",
  "radiusLg",
  "radiusFull",
  "shadowSm",
  "shadowMd",
  "shadowLg",
];

function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function getTypographyVarName(key: ThemeTypographyKey): string {
  if (key === "lineHeight") {
    return "--np-line-height";
  }

  return `--np-${camelToKebab(key)}`;
}

function formatDeclaration(name: string, value: string): string {
  return `    ${name}: ${sanitizeTokenValue(value)};`;
}

/**
 * Emits the active theme's tokens as CSS custom properties
 * under `:root`, wrapped in `@layer np-theme` so site CSS can
 * reliably override them.
 *
 * Color-scheme variants (light/dark) are intentionally not
 * generated here — the framework no longer prescribes a
 * dark-mode shape. Themes that opt into a color-mode toggle
 * mount `<NpColorSchemeScript />` inside their own shell and
 * ship a `[data-theme="dark"] { … }` block in their own CSS
 * (`impl.css`), so each theme controls exactly which tokens
 * flip and how.
 */
export function generateThemeCss(theme: NpThemeTokens): string {
  const rootDeclarations = [
    ...COLOR_KEYS.map((key) => formatDeclaration(`--np-color-${camelToKebab(key)}`, theme.colors[key])),
    ...TYPOGRAPHY_KEYS.map((key) => formatDeclaration(getTypographyVarName(key), theme.typography[key])),
    ...SHAPE_KEYS.map((key) => formatDeclaration(`--np-${camelToKebab(key)}`, theme.shape[key])),
  ];

  return ["@layer np-theme {", "  :root {", ...rootDeclarations, "  }", "}"].join("\n");
}
