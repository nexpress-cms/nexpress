// postinstall runs immediately after `pnpm install`, before any
// build step. In the monorepo that means @nexpress/app's `dist/`
// doesn't exist yet on the very first install — the import would
// throw ERR_MODULE_NOT_FOUND. The banner is a nicety, not a
// requirement, so swallow that one case and let install finish.
// A scaffolded site receives a pre-built tarball, so this branch
// is never taken there.
try {
  await import("@nexpress/app/scripts/postinstall-notice");
} catch (err) {
  if (!(err instanceof Error) || !("code" in err) || err.code !== "ERR_MODULE_NOT_FOUND") {
    throw err;
  }
}

export {};
