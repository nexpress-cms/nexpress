import type { NxThemeTokens } from "@nexpress/core";

import { generateThemeCss } from "./generate-css.js";

interface NxThemeStyleProps {
  theme: NxThemeTokens;
}

export function NxThemeStyle({ theme }: NxThemeStyleProps) {
  const css = generateThemeCss(theme);

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
