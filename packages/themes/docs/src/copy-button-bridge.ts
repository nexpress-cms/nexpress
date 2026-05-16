// Sibling-depth re-export of the client CopyButton component.
//
// Same shape as `toc-scrollspy-bridge.ts` — tsup's `external` rule
// matches the import specifier verbatim, and a parent-relative spec
// from `src/blocks/` or `src/templates/` would bake
// `"../components/..."` into `dist/index.js` and escape the dist
// root at consume time. Routing through this sibling-depth bridge
// keeps the bundled specifier at `./components/copy-button.js`,
// which the package's `external` list matches.
export { CopyButton } from "./components/copy-button.js";
