import { getAllCollectionSlugs, getAllPluginIds, getPluginRegistration } from "@nexpress/core";

import { ensureFor } from "@/lib/bootstrap";

/**
 * Default landing page for __NX_PROJECT_NAME__. Confirms the install is
 * running and points at the admin so the next-step is obvious.
 *
 * Replace this file (or add a `pages` entry with slug `/` and let the
 * `[...slug]` catch-all render it) once you have real content.
 */
export default async function HomePage() {
  await ensureFor("read");

  const collections = getAllCollectionSlugs().sort();
  const plugins = getAllPluginIds()
    .map((id) => {
      const reg = getPluginRegistration(id);
      return { id, name: reg?.name, version: reg?.version };
    })
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] opacity-60">
          NexPress
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Welcome to __NX_PROJECT_NAME__.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed opacity-80">
          This is the default landing page. Sign in at{" "}
          <a className="underline" href="/admin">/admin</a> to create content, or
          edit <code className="rounded bg-black/5 px-1.5 py-0.5">src/collections</code>{" "}
          to add your own models.
        </p>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <a
          href="/admin"
          className="rounded-2xl border border-black/10 bg-white px-5 py-4 text-sm transition hover:border-black/30 hover:shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider opacity-60">Admin</div>
          <div className="mt-1 text-base font-medium">Sign in to /admin →</div>
          <p className="mt-1 text-xs opacity-70">
            Create your first admin with <code>pnpm seed:admin</code>.
          </p>
        </a>
        <a
          href="/api/openapi.json"
          className="rounded-2xl border border-black/10 bg-white px-5 py-4 text-sm transition hover:border-black/30 hover:shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider opacity-60">API</div>
          <div className="mt-1 text-base font-medium">OpenAPI spec →</div>
          <p className="mt-1 text-xs opacity-70">
            Live schema for every shipped route.
          </p>
        </a>
        <a
          href="/api/health"
          className="rounded-2xl border border-black/10 bg-white px-5 py-4 text-sm transition hover:border-black/30 hover:shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider opacity-60">Health</div>
          <div className="mt-1 text-base font-medium">Probe →</div>
          <p className="mt-1 text-xs opacity-70">
            Confirm DB + worker are reachable.
          </p>
        </a>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider opacity-70">
            Collections ({collections.length})
          </h2>
          {collections.length === 0 ? (
            <p className="mt-2 text-sm opacity-70">
              None registered yet. Add a <code>defineCollection</code> call in{" "}
              <code>src/collections/</code>.
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              {collections.map((slug) => (
                <li
                  key={slug}
                  className="rounded-full border border-black/10 px-3 py-1 font-mono text-xs"
                >
                  {slug}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-black/10 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider opacity-70">
            Plugins ({plugins.length})
          </h2>
          {plugins.length === 0 ? (
            <p className="mt-2 text-sm opacity-70">
              No plugins loaded.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {plugins.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{p.name ?? p.id}</span>
                  {p.version ? (
                    <span className="font-mono text-xs opacity-60">v{p.version}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
