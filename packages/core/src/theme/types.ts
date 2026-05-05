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
