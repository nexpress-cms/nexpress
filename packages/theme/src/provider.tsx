import type { NpThemeTokens } from "@nexpress/core";

import { generateThemeCss } from "./generate-css.js";

interface NpThemeStyleProps {
  theme: NpThemeTokens;
}

export function NpThemeStyle({ theme }: NpThemeStyleProps) {
  const css = generateThemeCss(theme);

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
