import {
  getAllCollectionSlugs,
  getAllPluginIds,
  getCollectionConfig,
  getPluginRegistration,
} from "@nexpress/core";

/**
 * Auto-rendered when a fresh NexPress install hits `/` and there's
 * no `pages` entry with slug `/` in the DB. Once an admin publishes
 * a home page (or someone seeds one), this disappears — the
 * catch-all picks the DB row first and only falls through here as
 * the empty-state.
 *
 * Goal: a working, friendly first impression that confirms the
 * install is healthy AND tells the operator the next step. We
 * surface live signals (registered collections, loaded plugins) so
 * the page itself proves the platform booted, then point at
 * `/admin` and the docs.
 */
export function DefaultHomePage() {
  const collectionSlugs = collectSiteCollections();
  const plugins = collectPluginInfo();

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] opacity-60">
          NexPress
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Your site is running.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed opacity-80">
          This is the default landing page that ships with every NexPress
          install. Sign in to <code className="rounded bg-black/5 px-1.5 py-0.5 text-base">/admin</code>{" "}
          and create a <code className="rounded bg-black/5 px-1.5 py-0.5 text-base">pages</code>{" "}
          entry with slug <code className="rounded bg-black/5 px-1.5 py-0.5 text-base">/</code> to
          replace this view with your real home.
        </p>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <a
          href="/admin"
          className="rounded-2xl border border-black/10 bg-white px-5 py-4 text-sm font-medium transition hover:border-black/30 hover:shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider opacity-60">
            Admin
          </div>
          <div className="mt-1 text-base">Sign in to /admin →</div>
          <p className="mt-1 text-xs opacity-70">
            Create your first admin with <code>pnpm seed:admin</code>.
          </p>
        </a>
        <a
          href="/api/openapi.json"
          className="rounded-2xl border border-black/10 bg-white px-5 py-4 text-sm font-medium transition hover:border-black/30 hover:shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider opacity-60">API</div>
          <div className="mt-1 text-base">OpenAPI spec →</div>
          <p className="mt-1 text-xs opacity-70">
            Live schema for every shipped route.
          </p>
        </a>
        <a
          href="https://github.com/hahabsw/nexpress"
          className="rounded-2xl border border-black/10 bg-white px-5 py-4 text-sm font-medium transition hover:border-black/30 hover:shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider opacity-60">
            Docs
          </div>
          <div className="mt-1 text-base">GitHub repo →</div>
          <p className="mt-1 text-xs opacity-70">
            Design notes, plugin catalog, AGENTS.md.
          </p>
        </a>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider opacity-70">
            Collections
          </h2>
          {collectionSlugs.length === 0 ? (
            <p className="mt-2 text-sm opacity-70">
              No collections registered. Add one in your{" "}
              <code>nexpress.config.ts</code>.
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              {collectionSlugs.map((slug) => (
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
              No plugins loaded. Add one to{" "}
              <code>nexpress.config.ts</code>&rsquo;s <code>plugins</code> array.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {plugins.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{p.name ?? p.id}</span>
                  {p.version ? (
                    <span className="font-mono text-xs opacity-60">
                      v{p.version}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-12 rounded-2xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200">
        <strong className="font-semibold">Default placeholder.</strong> This
        page is shown only when no published <code>pages</code> entry exists at
        slug <code>/</code>. Publish one in the admin to take over this URL —
        the placeholder disappears automatically the next time someone visits.
      </div>
    </section>
  );
}

/**
 * Filter out collections marked `admin.hideFromSite` (site UI
 * doesn't surface admin-only collections like `users`). Keeps the
 * card visually tight when the only collections are admin-side.
 */
function collectSiteCollections(): string[] {
  const result: string[] = [];
  for (const slug of getAllCollectionSlugs()) {
    try {
      const config = getCollectionConfig(slug);
      // No `hideFromSite` field exists on `NxCollectionConfig` today,
      // so this is a future-proof filter point — for now every
      // registered collection shows.
      void config;
      result.push(slug);
    } catch {
      // unreachable — `getAllCollectionSlugs` is the source of
      // truth for `getCollectionConfig`.
    }
  }
  return result.sort();
}

interface PluginCardInfo {
  id: string;
  name?: string;
  version?: string;
}

function collectPluginInfo(): PluginCardInfo[] {
  return getAllPluginIds()
    .map((id) => {
      const reg = getPluginRegistration(id);
      return {
        id,
        name: reg?.name,
        version: reg?.version,
      };
    })
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}
