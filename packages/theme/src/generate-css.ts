import { sanitizeTokenValue } from "@nexpress/core";
import type {
  NxThemeColors,
  NxThemeShape,
  NxThemeTokens,
  NxThemeTypography,
} from "@nexpress/core";

type ThemeColorKey = Extract<keyof NxThemeColors, string>;
type ThemeTypographyKey = Extract<keyof NxThemeTypography, string>;
type ThemeShapeKey = Extract<keyof NxThemeShape, string>;

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
    return "--nx-line-height";
  }

  return `--nx-${camelToKebab(key)}`;
}

function formatDeclaration(name: string, value: string): string {
  return `    ${name}: ${sanitizeTokenValue(value)};`;
}

export function generateThemeCss(theme: NxThemeTokens): string {
  const rootDeclarations = [
    ...COLOR_KEYS.map((key) => formatDeclaration(`--nx-color-${camelToKebab(key)}`, theme.colors[key])),
    ...TYPOGRAPHY_KEYS.map((key) => formatDeclaration(getTypographyVarName(key), theme.typography[key])),
    ...SHAPE_KEYS.map((key) => formatDeclaration(`--nx-${camelToKebab(key)}`, theme.shape[key])),
  ];

  const darkModeOverrides = COLOR_KEYS.flatMap((key) => {
    const value = theme.darkMode?.colors?.[key];

    if (value === undefined) {
      return [];
    }

    return [formatDeclaration(`--nx-color-${camelToKebab(key)}`, value)];
  });

  const sections = ["@layer nx-theme {", "  :root {", ...rootDeclarations, "  }"];

  if (darkModeOverrides.length > 0) {
    sections.push("  [data-theme=\"dark\"] {", ...darkModeOverrides, "  }");
  }

  sections.push("}");

  return sections.join("\n");
}
