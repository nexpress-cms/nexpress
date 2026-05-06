export interface NpThemeColors {
  primary: string;
  primaryForeground: string;
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  card: string;
  cardForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
}

export interface NpThemeTypography {
  fontHeading: string;
  fontBody: string;
  fontMono: string;
  fontSizeBase: string;
  lineHeight: string;
  fontSizeSm: string;
  fontSizeLg: string;
  fontSizeXl: string;
  fontSize2xl: string;
  fontSize3xl: string;
  fontSize4xl: string;
}

export interface NpThemeShape {
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusFull: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

export interface NpThemeTokens {
  colors: NpThemeColors;
  typography: NpThemeTypography;
  shape: NpThemeShape;
}

/**
 * Author-facing partial token shape. Themes that override only a
 * few colors / fonts / radii ship one of these via `defineTheme`'s
 * `impl.tokens`. Each sub-tree is `Partial<...>` so a theme that
 * sets only `colors.primary` doesn't have to copy the rest of
 * `colors` from `DEFAULT_THEME`. The runtime merger
 * (`getTheme()` in `content/helpers.ts`) layers an overlay onto
 * `DEFAULT_THEME` field-by-field.
 */
export interface NpThemeTokensOverlay {
  colors?: Partial<NpThemeColors>;
  typography?: Partial<NpThemeTypography>;
  shape?: Partial<NpThemeShape>;
}
