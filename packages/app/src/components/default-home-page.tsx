import {
  NpValidationError,
  getAllCollectionSlugs,
  getAllPluginIds,
  getCollectionConfig,
  getI18nConfig,
  getPluginRegistration,
} from "@nexpress/core";
import type { NpResolvedNavItem } from "@nexpress/core/navigation";
import { getCachedActiveTheme, getCachedNavigation } from "@nexpress/next";

/**
 * Auto-rendered when a fresh NexPress install hits `/` and there's
 * no `pages` entry with slug `/` in the DB. Once an admin publishes
 * a home page (or someone seeds one), this disappears — the
 * catch-all picks the DB row first and only falls through here as
 * the empty-state.
 *
 * Goal: a working, friendly first impression that confirms the
 * install is healthy AND tells the operator the next step. We
 * surface live signals (registered collections, loaded plugins,
 * active theme, navigation menus) so the page itself proves the
 * platform booted, then point at `/admin`, the built-in feature
 * routes, and the docs.
 */
export async function DefaultHomePage() {
  const collectionSlugs = collectSiteCollections();
  const plugins = collectPluginInfo();
  const [headerNav, footerNav] = await Promise.all([safeGetNav("header"), safeGetNav("footer")]);
  const activeTheme = await safeGetActiveTheme();
  const i18n = getI18nConfig();

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] opacity-60">NexPress</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Your site is running.</h1>
        <p className="max-w-2xl text-lg leading-relaxed opacity-80">
          This is the default landing page that ships with every NexPress install. Sign in to{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 text-base">/admin</code> and create a{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 text-base">pages</code> entry with slug{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 text-base">/</code> to replace this view
          with your real home.
        </p>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <a
          href="/admin"
          className="rounded-2xl border border-black/10 bg-white px-5 py-4 text-sm font-medium transition hover:border-black/30 hover:shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider opacity-60">Admin</div>
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
          <p className="mt-1 text-xs opacity-70">Live schema for every shipped route.</p>
        </a>
        <a
          href="https://github.com/nexpress-cms/nexpress"
          className="rounded-2xl border border-black/10 bg-white px-5 py-4 text-sm font-medium transition hover:border-black/30 hover:shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider opacity-60">Docs</div>
          <div className="mt-1 text-base">GitHub repo →</div>
          <p className="mt-1 text-xs opacity-70">Design notes, plugin catalog, AGENTS.md.</p>
        </a>
      </div>

      <section className="mt-12">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Try built-in features</h2>
          <span className="text-xs opacity-60">Public routes that ship with every install</span>
        </header>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CORE_FEATURE_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group rounded-2xl border border-black/10 bg-white px-5 py-4 transition hover:border-black/30 hover:shadow-sm"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base font-medium">{link.title}</span>
                <code className="font-mono text-xs opacity-60 group-hover:opacity-90">
                  {link.href}
                </code>
              </div>
              <p className="mt-1 text-sm leading-relaxed opacity-70">{link.description}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-2">
        <NavigationCard
          location="header"
          items={headerNav}
          emptyHint="No header menu yet — running pnpm seed:content adds Posts / About / Discussions."
        />
        <NavigationCard
          location="footer"
          items={footerNav}
          emptyHint="No footer menu yet — the seed script adds About / Contact / GitHub."
        />
      </section>

      <section className="mt-6 grid gap-3 rounded-2xl border border-black/10 bg-white px-5 py-4 sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-wider opacity-60">Active theme</div>
          <div className="mt-1 text-base font-medium">{activeTheme?.name ?? "default"}</div>
          {activeTheme?.version ? (
            <div className="font-mono text-xs opacity-60">v{activeTheme.version}</div>
          ) : null}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider opacity-60">Locales</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-sm">
            {(i18n?.locales ?? ["en"]).map((loc) => (
              <span
                key={loc}
                className={
                  loc === (i18n?.defaultLocale ?? "en")
                    ? "rounded-full bg-black px-2.5 py-0.5 font-mono text-xs text-white"
                    : "rounded-full border border-black/15 px-2.5 py-0.5 font-mono text-xs"
                }
              >
                {loc}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider opacity-60">Discovery</div>
          <ul className="mt-1 space-y-1 text-sm">
            <li>
              <a className="underline-offset-4 hover:underline" href="/feed.xml">
                /feed.xml
              </a>{" "}
              <span className="opacity-60">— Atom</span>
            </li>
            <li>
              <a className="underline-offset-4 hover:underline" href="/sitemap.xml">
                /sitemap.xml
              </a>{" "}
              <span className="opacity-60">— Sitemap</span>
            </li>
          </ul>
        </div>
      </section>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider opacity-70">Collections</h2>
          {collectionSlugs.length === 0 ? (
            <p className="mt-2 text-sm opacity-70">
              No collections registered. Add one in your <code>nexpress.config.ts</code>.
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
              No plugins loaded. Add one to <code>nexpress.config.ts</code>&rsquo;s{" "}
              <code>plugins</code> array.
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

      <div className="mt-12 rounded-2xl border border-emerald-300/60 bg-emerald-50 px-5 py-4 text-sm leading-relaxed text-emerald-900 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-200">
        <strong className="font-semibold">Want sample content?</strong> Run{" "}
        <code className="rounded bg-black/5 px-1.5 py-0.5">pnpm seed:content</code> once
        you&rsquo;ve created an admin. It seeds a home page, an About / Contact page, three sample
        posts, and the header / footer menus so the public site has something real to show.
      </div>

      <div className="mt-4 rounded-2xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200">
        <strong className="font-semibold">Default placeholder.</strong> This page is shown only when
        no published <code>pages</code> entry exists at slug <code>/</code>. Publish one in the
        admin to take over this URL — the placeholder disappears automatically the next time someone
        visits.
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
      // No `hideFromSite` field exists on `NpCollectionConfig` today,
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

const CORE_FEATURE_LINKS: ReadonlyArray<{
  title: string;
  href: string;
  description: string;
}> = [
  {
    title: "Blog",
    href: "/blog",
    description: "Posts collection — list view + per-slug detail pages.",
  },
  {
    title: "Discussions",
    href: "/discussions",
    description: "Member-authored threads with comments and reactions.",
  },
  {
    title: "Search",
    href: "/search",
    description: "Full-text search across published pages and posts.",
  },
  {
    title: "Member sign in",
    href: "/members/login",
    description: "JWT + Argon2 auth for site members (separate from admin).",
  },
  {
    title: "Member sign up",
    href: "/members/register",
    description: "Self-service member registration with email verification.",
  },
  {
    title: "OpenAPI",
    href: "/api/openapi.json",
    description: "Live spec for every shipped REST endpoint.",
  },
];

// This is the empty-state landing page — it can run on a brand-new
// install where `pnpm db:migrate` hasn't created the `np_navigation`
// or `np_settings` tables yet. We swallow read errors so the page
// still renders something useful instead of crashing the whole site.
async function safeGetNav(location: "header" | "footer"): Promise<NpResolvedNavItem[]> {
  try {
    return await getCachedNavigation(location);
  } catch (error) {
    // A missing table is expected before first-run migrations. A malformed
    // persisted tree is not: keep the canonical read contract fail-closed.
    if (error instanceof NpValidationError) throw error;
    return [];
  }
}

async function safeGetActiveTheme(): Promise<{ name: string; version?: string } | null> {
  try {
    const active = await getCachedActiveTheme();
    if (!active) return null;
    return {
      name: active.manifest.name ?? active.manifest.id,
      version: active.manifest.version,
    };
  } catch {
    return null;
  }
}

function NavigationCard({
  location,
  items,
  emptyHint,
}: {
  location: "header" | "footer";
  items: NpResolvedNavItem[];
  emptyHint: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-black/10 bg-white px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider opacity-70">
          {location === "header" ? "Header menu" : "Footer menu"}
        </h2>
        <span className="min-w-0 break-all font-mono text-xs opacity-60">
          getCachedNavigation(&quot;{location}&quot;)
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed opacity-70">{emptyHint}</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 break-words">
                {item.url ? (
                  <a className="underline-offset-4 hover:underline" href={item.url}>
                    {item.label}
                  </a>
                ) : (
                  <span>{item.label}</span>
                )}
                {item.children && item.children.length > 0 ? (
                  <span className="ml-2 text-xs opacity-60">
                    +{item.children.length} child
                    {item.children.length === 1 ? "" : "ren"}
                  </span>
                ) : null}
              </span>
              <code className="shrink-0 font-mono text-xs opacity-60">{item.type}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
