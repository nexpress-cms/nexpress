"use client";

import { useEffect, useState } from "react";
import { Globe, Star } from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

/**
 * Phase 12.3 — read-only Settings → Locales view.
 *
 * Locales are configured in `nexpress.config.ts` (the locale
 * list is consumed at codegen + bootstrap time), so this tab
 * doesn't try to be an editor — it's a "what is configured"
 * dashboard for admins so they don't have to crack open the
 * config file to see which locales are live.
 *
 * Sites without an `i18n` block see an empty-state explaining
 * how to enable i18n.
 */

interface I18nConfig {
  enabled: boolean;
  locales?: string[];
  defaultLocale?: string;
}

export function LocalesTab() {
  const [config, setConfig] = useState<I18nConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await nxFetch("/api/admin/i18n");
      const body = (await res.json().catch(() => null)) as I18nConfig | null;
      if (!res.ok || !body) {
        setError("Unable to load i18n config.");
        return;
      }
      setConfig(body);
    } catch {
      setError("Unable to load i18n config.");
    }
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (!config) {
    return (
      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardContent className="pt-6">
          <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-16 w-full animate-pulse rounded bg-muted/50" />
        </CardContent>
      </Card>
    );
  }

  if (!config.enabled) {
    return (
      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Locales
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            i18n is not configured. To enable multi-language content, add an{" "}
            <code>i18n</code> block to <code>nexpress.config.ts</code>:
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
    <Card className="border-border/70 bg-card/80 shadow-sm">
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
              <li
                key={locale}
                className="flex items-center justify-between py-3"
              >
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
  );
}
