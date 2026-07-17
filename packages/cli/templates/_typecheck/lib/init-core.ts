// Stub — the real `src/lib/init-core.ts` lives under
// `templates/snapshot/src/lib/init-core.ts` (frozen copy of
// apps/web's bootstrap entry point). The CLI's content templates
// reach for `ensureFor` via `@/lib/init-core`; this stub is what
// `tsconfig.templates.json` resolves to, while the snapshot ships
// the real implementation into a scaffolded project. Keeping the
// stub here avoids dragging the entire reference-app dep graph
// into packages/cli's typecheck.

export async function ensureFor(_intent: "read" | "plugins" | "write"): Promise<void> {
  /* stubbed */
}

export const nexpressConfig: { site: { name: string; url: string } } = {
  site: { name: "stub", url: "http://localhost:3000" },
};
