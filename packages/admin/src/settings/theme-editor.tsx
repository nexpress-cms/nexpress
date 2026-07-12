"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_THEME, npValidateThemeTokens, type NpThemeTokens } from "@nexpress/core/theme";
import { Download, Palette, RotateCcw, Save, Square, Type, Upload } from "lucide-react";

import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { npFetch } from "../lib/api-client.js";
import {
  PARSE_ERROR_MESSAGES,
  downloadFilename,
  parseImportedTheme,
  serializeTheme,
} from "./theme-io.js";

const colorFields: Array<{ key: keyof NpThemeTokens["colors"]; label: string }> = [
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
  key: keyof NpThemeTokens["typography"];
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

const shapeFields: Array<{ key: keyof NpThemeTokens["shape"]; label: string }> = [
  { key: "radiusSm", label: "Small radius" },
  { key: "radiusMd", label: "Medium radius" },
  { key: "radiusLg", label: "Large radius" },
  { key: "radiusFull", label: "Full radius" },
  { key: "shadowSm", label: "Small shadow" },
  { key: "shadowMd", label: "Medium shadow" },
  { key: "shadowLg", label: "Large shadow" },
];

export function ThemeEditor() {
  const [theme, setTheme] = useState<NpThemeTokens>(DEFAULT_THEME);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function fetchTheme() {
    setLoading(true);
    setError(null);

    try {
      const response = await npFetch("/api/settings/theme");
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to load theme settings."));
        return;
      }

      const validation = npValidateThemeTokens(payload);
      if (!validation.ok) {
        setError(`${validation.issue.path}: ${validation.issue.message}`);
        return;
      }
      setTheme(payload as NpThemeTokens);
    } catch {
      setError("Unable to load theme settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchTheme();
  }, []);

  async function saveTheme() {
    const validation = npValidateThemeTokens(theme);
    if (!validation.ok) {
      setError(`${validation.issue.path}: ${validation.issue.message}`);
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await npFetch("/api/settings/theme", {
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

  function exportTheme() {
    const blob = new Blob([serializeTheme(theme)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMessage("Theme exported.");
    setError(null);
  }

  async function handleImportFile(file: File) {
    setError(null);
    setMessage(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("Could not read the selected file.");
      return;
    }
    const result = parseImportedTheme(text, theme);
    if (!result.ok) {
      setError(result.message ?? PARSE_ERROR_MESSAGES[result.reason]);
      return;
    }
    setTheme(result.theme);
    setMessage("Theme imported. Click Save Theme to apply.");
  }

  if (loading) {
    return (
      <div className="grid min-w-0 gap-6 xl:grid-cols-[1.25fr_0.85fr]">
        <div className="min-w-0 space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`theme-skeleton-${index}`}
              className="h-48 animate-pulse rounded-xl border border-border/70 bg-muted/40"
            />
          ))}
        </div>
        <div className="h-[420px] animate-pulse rounded-xl border border-border/70 bg-muted/40" />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[1.25fr_0.85fr]">
      <div className="min-w-0 space-y-6">
        {error ? (
          <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="break-words rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
            {message}
          </div>
        ) : null}

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <Palette className="h-4 w-4" />
              <span className="min-w-0 break-words">Colors</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4 sm:grid-cols-2">
            {colorFields.map(({ key, label }) => (
              <div key={key} className="min-w-0 space-y-2">
                <Label htmlFor={`theme-color-${key}`}>{label}</Label>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-3">
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

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <Type className="h-4 w-4" />
              <span className="min-w-0 break-words">Typography</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4 sm:grid-cols-2">
            {typographyFields.map(({ key, label }) => (
              <div key={key} className="min-w-0 space-y-2">
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

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <Square className="h-4 w-4" />
              <span className="min-w-0 break-words">Shape & depth</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-6">
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              {shapeFields.map(({ key, label }) => (
                <div key={key} className="min-w-0 space-y-2">
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

            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end sm:gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset the input so picking the same file twice
                  // still fires `onChange`.
                  event.target.value = "";
                  if (file) {
                    void handleImportFile(file);
                  }
                }}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto"
              >
                <Upload className="size-3.5" />
                Import JSON
              </Button>
              <Button variant="outline" onClick={exportTheme} className="w-full sm:w-auto">
                <Download className="size-3.5" />
                Export JSON
              </Button>
              <Button
                variant="outline"
                onClick={() => setTheme(DEFAULT_THEME)}
                className="w-full sm:w-auto"
              >
                <RotateCcw className="size-3.5" />
                Reset to Defaults
              </Button>
              <Button
                onClick={() => void saveTheme()}
                disabled={saving}
                className="w-full sm:w-auto"
              >
                <Save className="size-3.5" />
                {saving ? "Saving..." : "Save Theme"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 xl:sticky xl:top-6 xl:h-fit">
        <CardHeader>
          <CardTitle className="break-words">Live preview</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div
            className="min-w-0 space-y-5 rounded-[28px] border p-5"
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
            <div className="min-w-0 space-y-2">
              <h3
                className="break-words text-3xl font-semibold"
                style={{
                  fontFamily: theme.typography.fontHeading,
                  fontSize: theme.typography.fontSize3xl,
                  lineHeight: theme.typography.lineHeight,
                }}
              >
                Editorial but practical.
              </h3>
              <p
                className="break-words text-sm"
                style={{
                  fontFamily: theme.typography.fontBody,
                  fontSize: theme.typography.fontSizeBase,
                  lineHeight: theme.typography.lineHeight,
                }}
              >
                Preview how the palette, type ramp, and surfaces feel together before shipping
                changes live.
              </p>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div
                className="rounded-xl border p-4"
                style={{
                  backgroundColor: theme.colors.card,
                  color: theme.colors.cardForeground,
                  borderColor: theme.colors.border,
                  borderRadius: theme.shape.radiusMd,
                }}
              >
                <div
                  className="mb-3 h-2 w-20 rounded-full"
                  style={{ backgroundColor: theme.colors.accent }}
                />
                <p className="break-words font-medium">Content card</p>
                <p className="mt-1 break-words text-sm opacity-80">
                  Quiet surfaces with strong hierarchy.
                </p>
              </div>
              <div
                className="rounded-xl p-4"
                style={{
                  backgroundColor: theme.colors.primary,
                  color: theme.colors.primaryForeground,
                  borderRadius: theme.shape.radiusMd,
                }}
              >
                <p className="break-words font-medium">Primary action</p>
                <p className="mt-1 break-words text-sm opacity-80">
                  Contrast stays crisp at every scale.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }

  if (isRecord(payload) && isRecord(payload.error)) {
    const details = payload.error.details;
    if (Array.isArray(details) && isRecord(details[0])) {
      const field = typeof details[0].field === "string" ? details[0].field : null;
      const message = typeof details[0].message === "string" ? details[0].message : null;
      if (message) return field ? `${field}: ${message}` : message;
    }
    if (typeof payload.error.message === "string") return payload.error.message;
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
