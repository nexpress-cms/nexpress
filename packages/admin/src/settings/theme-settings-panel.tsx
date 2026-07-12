"use client";

import { useEffect, useState, useCallback } from "react";
import type { NpThemeSettingsField } from "@nexpress/core";
import { Loader2, Save } from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { ZodForm, type ZodFormValue } from "../zod-form/index.js";

/**
 * Phase F.3 — operator-facing settings panel for the active
 * theme. Fetches the introspected schema + current value from
 * `/api/admin/themes/[id]/settings`, renders the auto-form, and
 * PUTs the form value back on save.
 *
 * Themes without a `settingsSchema` produce an empty `fields`
 * array — the panel renders an "no settings to configure"
 * message and hides the save button.
 */

interface ThemeSettingsResponse {
  themeId: string;
  fields: NpThemeSettingsField[];
  value: ZodFormValue;
  hasPersisted: boolean;
}

export function ThemeSettingsPanel({ themeId }: { themeId: string }) {
  const [data, setData] = useState<ThemeSettingsResponse | null>(null);
  const [draft, setDraft] = useState<ZodFormValue>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setMessage(null);
    try {
      const res = await npFetch(`/api/admin/themes/${encodeURIComponent(themeId)}/settings`);
      const payload = (await res.json().catch(() => null)) as
        ThemeSettingsResponse | { error?: { message?: string } } | null;
      if (!res.ok) {
        const errMsg =
          payload && "error" in payload && payload.error?.message
            ? payload.error.message
            : "Unable to load settings.";
        setError(errMsg);
        return;
      }
      const r = payload as ThemeSettingsResponse;
      setData(r);
      setDraft(r.value);
    } catch {
      setError("Unable to load settings.");
    }
  }, [themeId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await npFetch(`/api/admin/themes/${encodeURIComponent(themeId)}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: draft }),
      });
      const payload = (await res.json().catch(() => null)) as {
        value?: ZodFormValue;
        error?: { message?: string; details?: unknown };
      } | null;
      if (!res.ok) {
        setError(payload?.error?.message ?? "Unable to save settings.");
        return;
      }
      setMessage("Saved. The site will pick up the new settings on the next request.");
      if (payload?.value && data) setData({ ...data, value: payload.value });
    } catch {
      setError("Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!data && !error) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="break-words">Theme settings</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <p className="break-words text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="break-words">Theme settings</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {error ? (
          <div className="break-words rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="break-words rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            {message}
          </div>
        ) : null}

        {data ? (
          <>
            {/* `key={data.themeId}` forces ZodForm remount when
                the operator switches active theme — without it,
                the form's internal `useState(initialValue)` only
                takes effect on first mount and would render the
                previous theme's draft against the new theme's
                schema. */}
            <ZodForm
              key={data.themeId}
              fields={data.fields}
              initialValue={data.value}
              onChange={setDraft}
              emptyMessage="This theme doesn't expose any operator settings."
            />
            {data.fields.length > 0 ? (
              <div className="grid sm:flex sm:justify-end">
                {/* Disable save while loading the next theme's
                    schema — otherwise a click during the load
                    transition would PUT the previous theme's
                    draft to the new theme's settings row. */}
                <Button
                  onClick={() => void save()}
                  disabled={saving || !data}
                  className="w-full sm:w-auto"
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-3 w-3" />
                      Save settings
                    </>
                  )}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
