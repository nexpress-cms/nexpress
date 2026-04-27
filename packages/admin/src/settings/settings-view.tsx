"use client";

import { useEffect, useState } from "react";

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Textarea } from "../ui/textarea.js";
import { LocalesTab } from "./locales-tab.js";
import { NavigationEditor } from "./navigation-editor.js";
import { SeoSettingsTab } from "./seo-settings-tab.js";
import { StringsTab } from "./strings-tab.js";
import { ThemeEditor } from "./theme-editor.js";
import { ThemeSwitcher } from "./theme-switcher.js";
import { UserManagement } from "./user-management.js";

type GeneralSettings = {
  siteName: string;
  siteUrl: string;
  description: string;
};

const defaultSettings: GeneralSettings = {
  siteName: "",
  siteUrl: "",
  description: "",
};

export function SettingsView() {
  const [settings, setSettings] = useState<GeneralSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchSettings();
  }, []);

  async function fetchSettings() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/settings");
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to load settings."));
        return;
      }

      setSettings(normalizeSettings(payload));
    } catch {
      setError("Unable to load settings.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updates: Array<{ key: string; value: unknown }> = [
        { key: "site", value: { name: settings.siteName, url: settings.siteUrl } },
        { key: "description", value: settings.description },
      ];

      for (const update of updates) {
        const response = await nxFetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as unknown;
          setError(getErrorMessage(payload, "Unable to save settings."));
          return;
        }
      }

      setMessage("Settings saved.");
    } catch {
      setError("Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Site control
        </p>
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Settings</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Tune brand language, navigation structure, and admin-facing defaults from one place.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 gap-2 md:w-auto md:grid-cols-7">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="theme">Theme</TabsTrigger>
          <TabsTrigger value="navigation">Navigation</TabsTrigger>
          <TabsTrigger value="locales">Locales</TabsTrigger>
          <TabsTrigger value="strings">Strings</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <CardTitle>General settings</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Update the public-facing site identity used across metadata and admin panels.
                </p>
              </div>
              <Button onClick={() => void saveSettings()} disabled={saving || loading}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              {message ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600">
                  {message}
                </div>
              ) : null}

              {loading ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`settings-skeleton-${index}`} className="space-y-2">
                      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                      <div className="h-11 animate-pulse rounded-xl bg-muted" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="settings-site-name">Site name</Label>
                    <Input
                      id="settings-site-name"
                      value={settings.siteName}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          siteName: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="settings-site-url">Site URL</Label>
                    <Input
                      id="settings-site-url"
                      value={settings.siteUrl}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          siteUrl: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="settings-description">Description</Label>
                    <Textarea
                      id="settings-description"
                      rows={5}
                      value={settings.description}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo">
          <SeoSettingsTab />
        </TabsContent>

        <TabsContent value="theme" className="space-y-6">
          <ThemeSwitcher />
          <ThemeEditor />
        </TabsContent>

        <TabsContent value="navigation">
          <NavigationEditor />
        </TabsContent>

        <TabsContent value="locales">
          <LocalesTab />
        </TabsContent>

        <TabsContent value="strings">
          <StringsTab />
        </TabsContent>

        <TabsContent value="users">
          <UserManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function normalizeSettings(payload: unknown): GeneralSettings {
  if (!isRecord(payload)) {
    return defaultSettings;
  }

  const site = isRecord(payload.site) ? payload.site : {};

  return {
    siteName:
      typeof site.name === "string"
        ? site.name
        : typeof payload.siteName === "string"
          ? payload.siteName
          : "",
    siteUrl:
      typeof site.url === "string"
        ? site.url
        : typeof payload.siteUrl === "string"
          ? payload.siteUrl
          : "",
    description: typeof payload.description === "string" ? payload.description : "",
  };
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") {
      return payload.error;
    }
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
