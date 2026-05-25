"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Globe, Star } from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

/**
 * Phase 12.3 — read-only Settings → Locales view.
 *
 * Locales are configured in `nexpress.config.ts` (the locale
 * list is consumed at codegen + bootstrap time), so this tab
 * doesn't try to be an editor — it's a "what is configured"
 * dashboard for admins so they don't have to crack open the
 * config file to see which locales are live.
 *
 * Phase 12.6 — added a per-collection translation completeness
 * matrix below the configured-locale list so admins can see at
 * a glance which collections are lagging in which locales.
 *
 * Sites without an `i18n` block see an empty-state explaining
 * how to enable i18n.
 */

interface I18nConfig {
  enabled: boolean;
  locales?: string[];
  defaultLocale?: string;
}

interface TranslationProgressCollection {
  collection: string;
  totalGroups: number;
  perLocale: Record<string, { count: number; missing: number }>;
}

interface TranslationProgress {
  defaultLocale: string;
  locales: string[];
  collections: TranslationProgressCollection[];
}

export function LocalesTab() {
  const [config, setConfig] = useState<I18nConfig | null>(null);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [configRes, progressRes] = await Promise.all([
        npFetch("/api/admin/i18n"),
        npFetch("/api/admin/i18n/progress"),
      ]);
      const body = (await configRes.json().catch(() => null)) as I18nConfig | null;
      if (!configRes.ok || !body) {
        setError("Unable to load i18n config.");
        return;
      }
      setConfig(body);
      // Progress is optional — failures don't block the
      // configured-locale list from rendering.
      if (progressRes.ok) {
        const progressBody = (await progressRes
          .json()
          .catch(() => null)) as TranslationProgress | null;
        if (progressBody && Array.isArray(progressBody.collections)) {
          setProgress(progressBody);
        }
      }
    } catch {
      setError("Unable to load i18n config.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="text-[13px] text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (!config) {
    return (
      <Card>
        <CardContent>
          <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-16 w-full animate-pulse rounded bg-muted/50" />
        </CardContent>
      </Card>
    );
  }

  if (!config.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Locales
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            i18n is not configured. To enable multi-language content, add an <code>i18n</code> block
            to <code>nexpress.config.ts</code>:
          </p>
          <pre className="rounded-xl border border-border/70 bg-muted/40 p-4 font-mono text-xs leading-relaxed">{`i18n: {
  locales: ["en", "ko"],
  defaultLocale: "en",
}`}</pre>
          <p>
            Then opt collections in with <code>i18n: true</code> in their{" "}
            <code>defineCollection</code> config and run{" "}
            <code>pnpm db:generate &amp;&amp; pnpm db:migrate</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Locales
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Configured at build time. To add or remove a locale, edit{" "}
            <code>nexpress.config.ts</code> and redeploy.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60">
            {(config.locales ?? []).map((locale) => {
              const isDefault = locale === config.defaultLocale;
              return (
                <li key={locale} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded-md border border-border/70 bg-background px-2 py-0.5 font-mono text-xs uppercase">
                      {locale}
                    </span>
                    {isDefault ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {isDefault
                      ? "Used when no locale is requested or a translation is missing."
                      : "Available for translations."}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {progress ? <TranslationProgressCard progress={progress} /> : null}
    </div>
  );
}

function TranslationProgressCard({ progress }: { progress: TranslationProgress }) {
  if (progress.collections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Translation progress
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No i18n-enabled collections registered yet. Set <code>i18n: true</code> on a collection in{" "}
          <code>defineCollection</code> to start tracking translations.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Translation progress
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Each row is one i18n-enabled collection. Numbers are live row counts per locale; the
          missing badge shows how many translation groups still need a translation in that locale.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200/70 dark:border-neutral-800/70">
                <th className="h-9 pr-4 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                  Collection
                </th>
                <th className="h-9 pr-4 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                  Groups
                </th>
                {progress.locales.map((locale) => (
                  <th
                    key={locale}
                    className="h-9 pr-4 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400"
                  >
                    {locale.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {progress.collections.map((row) => (
                <tr key={row.collection} className="border-b border-border/40 last:border-0">
                  <td className="py-3 pr-4 font-medium">{row.collection}</td>
                  <td className="py-3 pr-4 tabular-nums text-muted-foreground">
                    {row.totalGroups}
                  </td>
                  {progress.locales.map((locale) => {
                    const cell = row.perLocale[locale];
                    if (!cell) {
                      return (
                        <td key={locale} className="py-3 pr-4 text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    const complete = cell.missing === 0 && row.totalGroups > 0;
                    return (
                      <td key={locale} className="py-3 pr-4 tabular-nums">
                        <span
                          className={
                            complete
                              ? "font-medium text-emerald-600 dark:text-emerald-400"
                              : cell.missing > 0
                                ? "text-foreground"
                                : "text-muted-foreground"
                          }
                        >
                          {cell.count}
                        </span>
                        {cell.missing > 0 ? (
                          <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            -{cell.missing}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
