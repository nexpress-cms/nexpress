"use client";

import { useEffect, useState } from "react";

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";

/**
 * Phase 10.3 — SEO settings tab. Lives next to General / Theme /
 * Navigation / Users in `<SettingsView />`. Loads the `seo` key
 * from `nx_settings`, lets admins set defaults that flow into
 * `<head>` tags via the framework's `buildPageMetadata` helper.
 *
 * Site name + description still live on the General tab — they
 * predate this surface and the duplication isn't worth chasing.
 * Order on the form: image first (most missed), Twitter handle
 * (specific to that platform), locale (rarely changed).
 */
interface SeoSettings {
  defaultOgImage: string;
  twitterHandle: string;
  defaultLocale: string;
}

const EMPTY: SeoSettings = {
  defaultOgImage: "",
  twitterHandle: "",
  defaultLocale: "en_US",
};

export function SeoSettingsTab() {
  const [settings, setSettings] = useState<SeoSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await nxFetch("/api/settings");
      const raw = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!res.ok) {
        setError(extract(raw) ?? `HTTP ${res.status}`);
        return;
      }
      const seo =
        raw && typeof raw === "object" && raw.seo && typeof raw.seo === "object"
          ? (raw.seo as Record<string, unknown>)
          : {};
      setSettings({
        defaultOgImage:
          typeof seo.defaultOgImage === "string" ? seo.defaultOgImage : "",
        twitterHandle:
          typeof seo.twitterHandle === "string" ? seo.twitterHandle : "",
        defaultLocale:
          typeof seo.defaultLocale === "string"
            ? seo.defaultLocale
            : "en_US",
      });
    } catch {
      setError("Unable to load SEO settings.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Empty string → null so the helper skips emitting tags
      // when a default isn't set. The validator will reject
      // malformed strings but accept the empty path explicitly.
      const value = {
        defaultOgImage: settings.defaultOgImage.trim() || null,
        twitterHandle:
          settings.twitterHandle.trim().replace(/^@/, "") || null,
        defaultLocale: settings.defaultLocale.trim() || "en_US",
      };
      const res = await nxFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "seo", value }),
      });
      if (!res.ok) {
        const raw = (await res.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        setError(extract(raw) ?? `HTTP ${res.status}`);
        return;
      }
      setMessage("SEO settings saved.");
    } catch {
      setError("Unable to save SEO settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle>SEO defaults</CardTitle>
          <p className="text-sm text-muted-foreground">
            Site-wide fallbacks for Open Graph and Twitter card metadata.
            Page-level overrides (per-document descriptions, cover images)
            still take precedence.
          </p>
        </div>
        <Button onClick={() => void save()} disabled={saving || loading}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}
        {message ? (
          <div
            role="status"
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300"
          >
            {message}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="seo-og-image">Default Open Graph image</Label>
          <Input
            id="seo-og-image"
            value={settings.defaultOgImage}
            onChange={(e) =>
              setSettings((s) => ({ ...s, defaultOgImage: e.target.value }))
            }
            placeholder="https://example.com/og.png or /og.png"
            disabled={loading || saving}
          />
          <p className="text-xs text-muted-foreground">
            Absolute URL or a path starting with <code>/</code>. Used when a
            page doesn&rsquo;t define its own cover image.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="seo-twitter">Twitter handle</Label>
          <Input
            id="seo-twitter"
            value={settings.twitterHandle}
            onChange={(e) =>
              setSettings((s) => ({ ...s, twitterHandle: e.target.value }))
            }
            placeholder="nexpress (no @)"
            disabled={loading || saving}
          />
          <p className="text-xs text-muted-foreground">
            Drives the <code>twitter:site</code> tag. Leave blank to omit.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="seo-locale">Default locale</Label>
          <Input
            id="seo-locale"
            value={settings.defaultLocale}
            onChange={(e) =>
              setSettings((s) => ({ ...s, defaultLocale: e.target.value }))
            }
            placeholder="en_US"
            disabled={loading || saving}
          />
          <p className="text-xs text-muted-foreground">
            BCP 47 tag (e.g. <code>en_US</code>, <code>ko_KR</code>). Drives{" "}
            <code>og:locale</code>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function extract(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const err = raw.error as Record<string, unknown> | undefined;
  if (typeof err?.message === "string") return err.message;
  if (typeof raw.message === "string") return raw.message;
  return null;
}
