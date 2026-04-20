"use client";

import { useEffect, useState } from "react";
import type { NxThemeTokens } from "@nexpress/core";
import { Moon, Palette, RotateCcw, Save, Square, Type } from "lucide-react";

import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Switch } from "../ui/switch.js";

const defaultTheme: NxThemeTokens = {
  colors: {
    primary: "#111827",
    primaryForeground: "#ffffff",
    background: "#f8fafc",
    foreground: "#111827",
    muted: "#e2e8f0",
    mutedForeground: "#475569",
    border: "#cbd5e1",
    card: "#ffffff",
    cardForeground: "#111827",
    accent: "#0f766e",
    accentForeground: "#f8fafc",
    destructive: "#dc2626",
    destructiveForeground: "#ffffff",
  },
  typography: {
    fontHeading: '"Fraunces", serif',
    fontBody: '"Source Serif 4", serif',
    fontMono: '"IBM Plex Mono", monospace',
    fontSizeBase: "16px",
    lineHeight: "1.6",
    fontSizeSm: "14px",
    fontSizeLg: "18px",
    fontSizeXl: "20px",
    fontSize2xl: "24px",
    fontSize3xl: "30px",
    fontSize4xl: "38px",
  },
  shape: {
    radiusSm: "6px",
    radiusMd: "12px",
    radiusLg: "20px",
    radiusFull: "999px",
    shadowSm: "0 1px 2px rgba(15, 23, 42, 0.08)",
    shadowMd: "0 18px 40px rgba(15, 23, 42, 0.12)",
    shadowLg: "0 26px 80px rgba(15, 23, 42, 0.18)",
  },
  darkMode: {
    colors: {
      background: "#020617",
      foreground: "#f8fafc",
      card: "#0f172a",
      cardForeground: "#f8fafc",
      muted: "#1e293b",
      mutedForeground: "#cbd5e1",
      border: "#334155",
      primary: "#f8fafc",
      primaryForeground: "#020617",
      accent: "#14b8a6",
      accentForeground: "#042f2e",
    },
  },
};

const colorFields: Array<{ key: keyof NxThemeTokens["colors"]; label: string }> = [
  { key: "primary", label: "Primary" },
  { key: "primaryForeground", label: "Primary foreground" },
  { key: "background", label: "Background" },
  { key: "foreground", label: "Foreground" },
  { key: "muted", label: "Muted" },
  { key: "mutedForeground", label: "Muted foreground" },
  { key: "border", label: "Border" },
  { key: "card", label: "Card" },
  { key: "cardForeground", label: "Card foreground" },
  { key: "accent", label: "Accent" },
  { key: "accentForeground", label: "Accent foreground" },
  { key: "destructive", label: "Destructive" },
  { key: "destructiveForeground", label: "Destructive foreground" },
];

const typographyFields: Array<{
  key: keyof NxThemeTokens["typography"];
  label: string;
}> = [
  { key: "fontHeading", label: "Heading font" },
  { key: "fontBody", label: "Body font" },
  { key: "fontMono", label: "Monospace font" },
  { key: "fontSizeBase", label: "Base font size" },
  { key: "lineHeight", label: "Line height" },
  { key: "fontSizeSm", label: "Small text size" },
  { key: "fontSizeLg", label: "Large text size" },
  { key: "fontSizeXl", label: "XL text size" },
  { key: "fontSize2xl", label: "2XL text size" },
  { key: "fontSize3xl", label: "3XL text size" },
  { key: "fontSize4xl", label: "4XL text size" },
];

const shapeFields: Array<{ key: keyof NxThemeTokens["shape"]; label: string }> = [
  { key: "radiusSm", label: "Small radius" },
  { key: "radiusMd", label: "Medium radius" },
  { key: "radiusLg", label: "Large radius" },
  { key: "radiusFull", label: "Full radius" },
  { key: "shadowSm", label: "Small shadow" },
  { key: "shadowMd", label: "Medium shadow" },
  { key: "shadowLg", label: "Large shadow" },
];

export function ThemeEditor() {
  const [theme, setTheme] = useState<NxThemeTokens>(defaultTheme);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchTheme();
  }, []);

  async function fetchTheme() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/theme");
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to load theme settings."));
        return;
      }

      setTheme(normalizeTheme(payload));
    } catch {
      setError("Unable to load theme settings.");
    } finally {
      setLoading(false);
    }
  }

  async function saveTheme() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(theme),
      });

      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to save theme settings."));
        return;
      }

      setMessage("Theme saved.");
    } catch {
      setError("Unable to save theme settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`theme-skeleton-${index}`}
              className="h-48 animate-pulse rounded-2xl border border-border/70 bg-muted/40"
            />
          ))}
        </div>
        <div className="h-[420px] animate-pulse rounded-2xl border border-border/70 bg-muted/40" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
      <div className="space-y-6">
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600">
            {message}
          </div>
        ) : null}

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Colors
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {colorFields.map(({ key, label }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`theme-color-${key}`}>{label}</Label>
                <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-3">
                  <input
                    id={`theme-color-${key}`}
                    type="color"
                    value={theme.colors[key]}
                    onChange={(event) =>
                      setTheme((current) => ({
                        ...current,
                        colors: { ...current.colors, [key]: event.target.value },
                      }))
                    }
                    className="h-10 w-12 rounded border border-border bg-transparent"
                  />
                  <Input
                    value={theme.colors[key]}
                    onChange={(event) =>
                      setTheme((current) => ({
                        ...current,
                        colors: { ...current.colors, [key]: event.target.value },
                      }))
                    }
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Type className="h-4 w-4" />
              Typography
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {typographyFields.map(({ key, label }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`theme-typography-${key}`}>{label}</Label>
                <Input
                  id={`theme-typography-${key}`}
                  value={theme.typography[key]}
                  onChange={(event) =>
                    setTheme((current) => ({
                      ...current,
                      typography: {
                        ...current.typography,
                        [key]: event.target.value,
                      },
                    }))
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Square className="h-4 w-4" />
              Shape & depth
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {shapeFields.map(({ key, label }) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`theme-shape-${key}`}>{label}</Label>
                  <Input
                    id={`theme-shape-${key}`}
                    value={theme.shape[key]}
                    onChange={(event) =>
                      setTheme((current) => ({
                        ...current,
                        shape: { ...current.shape, [key]: event.target.value },
                      }))
                    }
                  />
                </div>
              ))}
            </div>

            <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 font-medium text-foreground">
                    <Moon className="h-4 w-4" />
                    Dark mode override
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Enable a second palette for darker surfaces and richer contrast.
                  </p>
                </div>
                <Switch
                  checked={Boolean(theme.darkMode)}
                  onCheckedChange={(checked) =>
                    setTheme((current) => ({
                      ...current,
                      darkMode: checked ? current.darkMode ?? { colors: {} } : undefined,
                    }))
                  }
                />
              </div>

              {theme.darkMode ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {(() => {
                    const darkColors = theme.darkMode?.colors ?? {};

                    return colorFields.map(({ key, label }) => (
                      <div key={`dark-${key}`} className="space-y-2">
                        <Label htmlFor={`theme-dark-${key}`}>{label}</Label>
                        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-3">
                          <input
                            id={`theme-dark-${key}`}
                            type="color"
                            value={darkColors[key] ?? theme.colors[key]}
                            onChange={(event) =>
                              setTheme((current) => ({
                                ...current,
                                darkMode: {
                                  colors: {
                                    ...current.darkMode?.colors,
                                    [key]: event.target.value,
                                  },
                                },
                              }))
                            }
                            className="h-10 w-12 rounded border border-border bg-transparent"
                          />
                          <Input
                            value={darkColors[key] ?? theme.colors[key]}
                            onChange={(event) =>
                              setTheme((current) => ({
                                ...current,
                                darkMode: {
                                  colors: {
                                    ...current.darkMode?.colors,
                                    [key]: event.target.value,
                                  },
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="outline" onClick={() => setTheme(defaultTheme)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset to Defaults
              </Button>
              <Button onClick={() => void saveTheme()} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save Theme"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="sticky top-6 h-fit border-border/70 bg-card/80 shadow-sm">
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="space-y-5 rounded-[28px] border p-5"
            style={{
              backgroundColor: theme.colors.background,
              color: theme.colors.foreground,
              borderColor: theme.colors.border,
              borderRadius: theme.shape.radiusLg,
              boxShadow: theme.shape.shadowMd,
            }}
          >
            <div
              className="inline-flex rounded-full px-3 py-1 text-xs uppercase tracking-[0.24em]"
              style={{
                backgroundColor: theme.colors.muted,
                color: theme.colors.mutedForeground,
                borderRadius: theme.shape.radiusFull,
                fontFamily: theme.typography.fontMono,
              }}
            >
              Theme direction
            </div>
            <div className="space-y-2">
              <h3
                className="text-3xl font-semibold"
                style={{
                  fontFamily: theme.typography.fontHeading,
                  fontSize: theme.typography.fontSize3xl,
                  lineHeight: theme.typography.lineHeight,
                }}
              >
                Editorial but practical.
              </h3>
              <p
                className="text-sm"
                style={{
                  fontFamily: theme.typography.fontBody,
                  fontSize: theme.typography.fontSizeBase,
                  lineHeight: theme.typography.lineHeight,
                }}
              >
                Preview how the palette, type ramp, and surfaces feel together before shipping changes live.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div
                className="rounded-2xl border p-4"
                style={{
                  backgroundColor: theme.colors.card,
                  color: theme.colors.cardForeground,
                  borderColor: theme.colors.border,
                  borderRadius: theme.shape.radiusMd,
                }}
              >
                <div className="mb-3 h-2 w-20 rounded-full" style={{ backgroundColor: theme.colors.accent }} />
                <p className="font-medium">Content card</p>
                <p className="mt-1 text-sm opacity-80">Quiet surfaces with strong hierarchy.</p>
              </div>
              <div
                className="rounded-2xl p-4"
                style={{
                  backgroundColor: theme.colors.primary,
                  color: theme.colors.primaryForeground,
                  borderRadius: theme.shape.radiusMd,
                }}
              >
                <p className="font-medium">Primary action</p>
                <p className="mt-1 text-sm opacity-80">Contrast stays crisp at every scale.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function normalizeTheme(payload: unknown): NxThemeTokens {
  if (!isRecord(payload)) {
    return defaultTheme;
  }

  const source = isRecord(payload.theme) ? payload.theme : payload;

  return {
    colors: mergeColors(source.colors),
    typography: mergeTypography(source.typography),
    shape: mergeShape(source.shape),
    darkMode: isRecord(source.darkMode)
      ? {
          colors: mergePartialColors(source.darkMode.colors),
        }
      : undefined,
  };
}

function mergeColors(incoming: unknown): NxThemeTokens["colors"] {
  const next = { ...defaultTheme.colors };

  if (!isRecord(incoming)) {
    return next;
  }

  for (const { key } of colorFields) {
    const value = incoming[key];

    if (typeof value === "string") {
      next[key] = value;
    }
  }

  return next;
}

function mergeTypography(incoming: unknown): NxThemeTokens["typography"] {
  const next = { ...defaultTheme.typography };

  if (!isRecord(incoming)) {
    return next;
  }

  for (const { key } of typographyFields) {
    const value = incoming[key];

    if (typeof value === "string") {
      next[key] = value;
    }
  }

  return next;
}

function mergeShape(incoming: unknown): NxThemeTokens["shape"] {
  const next = { ...defaultTheme.shape };

  if (!isRecord(incoming)) {
    return next;
  }

  for (const { key } of shapeFields) {
    const value = incoming[key];

    if (typeof value === "string") {
      next[key] = value;
    }
  }

  return next;
}

function mergePartialColors(incoming: unknown) {
  if (!isRecord(incoming)) {
    return {};
  }

  const next: Partial<NxThemeTokens["colors"]> = {};

  for (const { key } of colorFields) {
    const value = incoming[key];

    if (typeof value === "string") {
      next[key] = value;
    }
  }

  return next;
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
