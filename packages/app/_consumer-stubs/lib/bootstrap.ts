// Stub target for `@nexpress/app/src/lib/*`'s `import "@/lib/bootstrap"`
// side-effect imports. Each consumer (apps/web, scaffolded projects)
// supplies the real `src/lib/bootstrap.ts` whose top-level
// `createBootstrap(...)` call registers the active runtime on
// `@nexpress/next`'s module-level state.
//
// Pre-refactor (#834 era) this file also exported `getDb`,
// `nexpressConfig`, `ensureCoreServices`, etc. as `any`-typed stubs
// so @nexpress/app's source typechecked. After the refactor the
// symbol exports moved to `@nexpress/next`, so this file only needs
// to *exist* — the side-effect import in `@nexpress/app/src/lib/*`
// resolves to it during @nexpress/app's own typecheck (against
// `_consumer-stubs/`), and to the real consumer file in Next's
// bundled output. No symbols are pulled through the alias anymore.
export {};
