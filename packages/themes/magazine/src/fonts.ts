// Static package-relative URLs remain inert during plain Node config discovery.
// Next emits the original vendored bytes into its same-origin static media tree.
const newsreaderNormal = new URL("./fonts/newsreader-normal.ttf", import.meta.url).href;
const newsreaderItalic = new URL("./fonts/newsreader-italic.ttf", import.meta.url).href;
const hankenGroteskNormal = new URL("./fonts/hanken-grotesk-normal.ttf", import.meta.url).href;

export const magazineFontCss = `
@font-face {
  font-family: "Newsreader";
  font-style: normal;
  font-weight: 400 800;
  font-display: swap;
  src: url("${newsreaderNormal}") format("truetype");
}
@font-face {
  font-family: "Newsreader";
  font-style: italic;
  font-weight: 400 800;
  font-display: swap;
  src: url("${newsreaderItalic}") format("truetype");
}
@font-face {
  font-family: "Hanken Grotesk";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("${hankenGroteskNormal}") format("truetype");
}
`;
