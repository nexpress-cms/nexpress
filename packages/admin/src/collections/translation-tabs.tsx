"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, Plus, Check } from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";

/**
 * Phase 12.3 — translation locale picker shown atop the
 * collection edit form when the collection is i18n-enabled.
 *
 * Each configured locale is a chip:
 *   - if a sibling row exists for that locale → click to
 *     navigate to its edit form
 *   - if no sibling exists → click to POST `create translation`,
 *     then navigate to the newly created row
 *
 * The active locale (matching the row currently being edited)
 * is highlighted but disabled to prevent self-navigation.
 *
 * Emits no UI for non-i18n collections (the picker is mounted
 * conditionally by the parent edit view).
 */

interface TranslationRow {
  id: string;
  locale: string;
  slug: string;
  status: string;
  title?: unknown;
}

interface I18nConfig {
  enabled: boolean;
  locales?: string[];
  defaultLocale?: string;
}

export function TranslationTabs({
  collectionSlug,
  documentId,
}: {
  collectionSlug: string;
  documentId: string;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<I18nConfig | null>(null);
  const [translations, setTranslations] = useState<TranslationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionSlug, documentId]);

  async function load() {
    setError(null);
    try {
      const [configRes, translationsRes] = await Promise.all([
        nxFetch("/api/admin/i18n"),
        nxFetch(
          `/api/admin/collections/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(documentId)}/translations`,
        ),
      ]);
      const configBody = (await configRes.json().catch(() => null)) as I18nConfig | null;
      const translationsBody = (await translationsRes.json().catch(() => null)) as
        | { docs?: TranslationRow[]; error?: { message?: string } }
        | null;
      if (configBody?.enabled === false) {
        setConfig({ enabled: false });
        return;
      }
      if (!configRes.ok || !configBody?.enabled) {
        setError("Unable to load i18n config.");
        return;
      }
      if (!translationsRes.ok) {
        setError(translationsBody?.error?.message ?? "Unable to load translations.");
        return;
      }
      setConfig(configBody);
      setTranslations(translationsBody?.docs ?? []);
    } catch {
      setError("Unable to load translations.");
    }
  }

  async function createForLocale(locale: string) {
    setCreatingFor(locale);
    setError(null);
    try {
      const res = await nxFetch(
        `/api/admin/collections/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(documentId)}/translations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetLocale: locale }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { id?: string; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.id) {
        setError(body?.error?.message ?? "Unable to create translation.");
        return;
      }
      router.push(
        `/admin/collections/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(body.id)}`,
      );
    } catch {
      setError("Unable to create translation.");
    } finally {
      setCreatingFor(null);
    }
  }

  if (!config || config.enabled === false) {
    return null;
  }

  if (!translations) {
    return (
      <div className="rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading translations…
      </div>
    );
  }

  // Identify the row being edited so we can mark its locale as
  // active. The `documentId` matches one of the translations.
  const current = translations.find((t) => t.id === documentId);
  const currentLocale = current?.locale;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        <Globe className="h-3.5 w-3.5" />
        <span>Translations</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {(config.locales ?? []).map((locale) => {
          const sibling = translations.find((t) => t.locale === locale);
          const isCurrent = locale === currentLocale;
          if (sibling) {
            return (
              <Button
                key={locale}
                size="sm"
                variant={isCurrent ? "default" : "outline"}
                disabled={isCurrent}
                onClick={() =>
                  router.push(
                    `/admin/collections/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(sibling.id)}`,
                  )
                }
                title={
                  isCurrent
                    ? "Currently editing"
                    : `Open ${locale} translation`
                }
              >
                {isCurrent ? (
                  <Check className="mr-1.5 h-3 w-3" />
                ) : null}
                {locale.toUpperCase()}
                <span className="ml-1.5 text-[11px] opacity-70">
                  {sibling.status === "published" ? "live" : "draft"}
                </span>
              </Button>
            );
          }
          return (
            <Button
              key={locale}
              size="sm"
              variant="outline"
              disabled={creatingFor !== null}
              onClick={() => void createForLocale(locale)}
              title={`Create ${locale} translation`}
            >
              {creatingFor === locale ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-3 w-3" />
              )}
              {locale.toUpperCase()}
            </Button>
          );
        })}
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
