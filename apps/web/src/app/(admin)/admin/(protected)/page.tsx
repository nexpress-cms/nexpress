// All admin dashboard logic lives in `@nexpress/app/admin/dashboard/page`.
// Next.js's app router requires route segment config (`dynamic`,
// `revalidate`, `metadata`, …) to be a *statically declared local
// const* in the page file — it can't be re-exported from another
// module. So config lives here; the React default export comes
// from the shared package via a 1-line re-export. apps/web and
// `npx create-nexpress`-scaffolded projects have this exact same
// file content so the rendered dashboard is byte-identical.
// To customize, replace `export { default } from …` with your
// own component.
export const dynamic = "force-dynamic";
export { default } from "@nexpress/app/admin/dashboard/page";
