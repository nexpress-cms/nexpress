"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save, Search } from "lucide-react";
import {
  npI18nContractLimits,
  npRequireI18nStringsResponse,
  type NpI18nStringsResponse,
} from "@nexpress/core/i18n-contract";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";

/**
 * Phase D — admin override editor for plugin / theme UI
 * strings. Lists every key registered by the merged
 * 12.5 bundle registry and lets admins layer per-site
 * overrides on top. The override value lives in
 * `np_string_overrides`; the framework's `t()` consults it
 * before falling through to the plugin/theme bundle.
 */

export function StringsTab() {
  const [data, setData] = useState<NpI18nStringsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Local edit buffer keyed by `${key}::${locale}`. Lets the
  // user type without round-tripping per keystroke.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      const res = await npFetch("/api/admin/i18n/strings");
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        setError(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            "Unable to load strings.",
        );
        return;
      }
      setData(npRequireI18nStringsResponse(body));
      setDrafts({});
    } catch {
      setError("Unable to load strings.");
    }
  }

  async function saveOverride(key: string, locale: string, value: string) {
    setBusyKey(`${key}::${locale}`);
    setError(null);
    try {
      const res = await npFetch("/api/admin/i18n/strings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, locale, value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Unable to save override.");
        return;
      }
      await load();
    } catch {
      setError("Unable to save override.");
    } finally {
      setBusyKey(null);
    }
  }

  async function clearOverride(key: string, locale: string) {
    setBusyKey(`${key}::${locale}`);
    setError(null);
    try {
      const res = await npFetch(
        `/api/admin/i18n/strings?locale=${encodeURIComponent(locale)}&key=${encodeURIComponent(key)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Unable to clear override.");
        return;
      }
      await load();
    } catch {
      setError("Unable to clear override.");
    } finally {
      setBusyKey(null);
    }
  }

  const filteredKeys = useMemo(() => {
    if (!data) return [];
    if (!filter.trim()) return data.keys;
    const needle = filter.trim().toLowerCase();
    return data.keys.filter((row) => row.key.toLowerCase().includes(needle));
  }, [data, filter]);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="break-words">UI Strings</CardTitle>
        <p className="break-words text-sm text-muted-foreground">
          Override plugin / theme UI strings without editing their code. Overrides are scoped to the
          current site
          {data?.siteId ? (
            <>
              {" "}
              (<code className="break-all">{data.siteId}</code>)
            </>
          ) : null}
          ; reverting an override drops back to the plugin/theme bundle.
        </p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {error ? (
          <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter keys (e.g. magazine.)"
            className="min-w-0 pl-8"
          />
        </div>

        {!data ? (
          <p className="break-words text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : filteredKeys.length === 0 ? (
          <p className="break-words text-sm text-muted-foreground">
            No keys registered (yet). Plugins / themes that ship i18n bundles will surface their
            keys here.
          </p>
        ) : (
          <div className="min-w-0 space-y-3">
            {filteredKeys.map((row) => (
              <Card key={row.key} className="min-w-0 border-border/60 bg-background">
                <CardContent className="min-w-0 space-y-3 pt-4">
                  <code className="break-all font-mono text-xs">{row.key}</code>
                  <div className="min-w-0 space-y-2">
                    {data.locales.map((locale) => {
                      const cell = row.values[locale] ?? {
                        base: null,
                        override: null,
                      };
                      const draftKey = `${row.key}::${locale}`;
                      const draftValue = drafts[draftKey] ?? cell.override ?? cell.base ?? "";
                      const isOverridden = cell.override !== null;
                      const dirty =
                        drafts[draftKey] !== undefined &&
                        drafts[draftKey] !== (cell.override ?? cell.base ?? "");
                      const busy = busyKey === draftKey;
                      return (
                        <div
                          key={locale}
                          className="grid min-w-0 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <code className="break-all font-mono text-xs uppercase">{locale}</code>
                            {isOverridden ? (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                Override
                              </span>
                            ) : null}
                          </div>
                          <Input
                            value={draftValue}
                            maxLength={npI18nContractLimits.messageLength}
                            placeholder={cell.base ?? "(no base translation)"}
                            onChange={(e) =>
                              setDrafts((d) => ({
                                ...d,
                                [draftKey]: e.target.value,
                              }))
                            }
                            disabled={busy}
                            className="min-w-0"
                          />
                          <div className="grid grid-cols-2 gap-1.5 sm:flex">
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full sm:w-auto"
                              disabled={!dirty || busy}
                              onClick={() => void saveOverride(row.key, locale, draftValue)}
                            >
                              {busy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Save className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full sm:w-auto"
                              disabled={!isOverridden || busy}
                              onClick={() => void clearOverride(row.key, locale)}
                              title="Revert to bundle value"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
