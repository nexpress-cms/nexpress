// Stub for tsc — the real `src/lib/bootstrap.ts` lives under
// `templates/snapshot/src/lib/bootstrap.ts` (frozen copy of
// apps/web's bootstrap). Surface just the symbols the CLI's
// content templates currently reach for via `@/lib/bootstrap`;
// extend this stub if a new template adds another import. The
// snapshot ships the real implementation into a scaffolded
// project; this stub keeps the CLI's `tsconfig.templates.json`
// from reaching into the snapshot subtree, which would drag the
// entire reference-app dep graph along with it.

export const nexpressConfig: { site: { name: string; url: string } } = {
  site: { name: "stub", url: "http://localhost:3000" },
};
export type NpDb = unknown;
