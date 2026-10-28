// Static package-relative URLs remain inert during plain Node config discovery.
// Next emits the original vendored bytes into its same-origin static media tree.
const instrumentSerifNormal = new URL("./fonts/instrument-serif-normal.ttf", import.meta.url).href;
const instrumentSerifItalic = new URL("./fonts/instrument-serif-italic.ttf", import.meta.url).href;
const hankenGroteskNormal = new URL("./fonts/hanken-grotesk-normal.ttf", import.meta.url).href;

export const portfolioFontCss = `
@font-face {
  font-family: "Instrument Serif";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("${instrumentSerifNormal}") format("truetype");
}
@font-face {
  font-family: "Instrument Serif";
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url("${instrumentSerifItalic}") format("truetype");
}
@font-face {
  font-family: "Hanken Grotesk";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("${hankenGroteskNormal}") format("truetype");
}
`;
