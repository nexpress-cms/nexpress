// Sibling-depth re-export of the client TocScrollspy component.
//
// Why this file exists: `doc-page.tsx` lives at `src/templates/`
// and needs the client island that lives at
// `src/components/toc-scrollspy.tsx`. Importing it directly
// would require `../components/toc-scrollspy.js`, and tsup's
// `external` rule matches the specifier verbatim — a parent-
// relative spec gets baked into `dist/index.js` and escapes the
// dist root at consume time (Turbopack reports `Module not
// found`).
//
// Routing through this bridge moves the externalized import to
// sibling-depth (`./components/toc-scrollspy.js`) which is what
// the `dist/` layout expects.
export { TocScrollspy } from "./components/toc-scrollspy.js";
