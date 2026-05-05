"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

/**
 * Phase 11.4 — admin theme switcher.
 *
 * Lists every theme registered in `nexpress.config.ts` (read
 * from `/api/admin/themes`) and lets an admin activate one
 * with a click. The chosen id is persisted to
 * `nx_settings.activeTheme` via `PUT /api/admin/themes/active`,
 * then `revalidatePath("/", "layout")` flushes the public
 * shell so the next request renders the new theme's header /
 * footer / CSS.
 *
 * No rebuild required for switching — the theme components
 * are already in the bundle (registered at boot from the
 * config). Adding a NEW theme still requires editing the
 * config and redeploying; this surface only changes which of
 * the already-installed themes is in effect.
 */

interface ThemeSummary {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: { name: string; url?: string };
  isActive: boolean;
}

export function ThemeSwitcher({
  onActivated,
}: {
  /** Optional callback fired after a successful activation —
   *  the parent panel uses this to refetch the theme tokens
   *  (a different theme may ship different defaults). */
  onActivated?: (id: string) => void;
}) {
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      const res = await nxFetch("/api/admin/themes");
      const payload = (await res.json().catch(() => null)) as {
        docs?: ThemeSummary[];
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(payload?.error?.message ?? "Unable to load themes.");
        return;
      }
      setThemes(payload?.docs ?? []);
    } catch {
      setError("Unable to load themes.");
    }
  }

  async function activate(id: string) {
    setActivatingId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await nxFetch("/api/admin/themes/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await res.json().catch(() => null)) as {
        activeId?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(payload?.error?.message ?? "Unable to activate theme.");
        return;
      }
      const activated = themes?.find((t) => t.id === id);
      setMessage(
        activated
          ? `Activated ${activated.name}. The public site will pick it up on the next request.`
          : "Theme activated.",
      );
      // Update local state optimistically; a full refetch is
      // unnecessary because the server confirmed the new id.
      setThemes((current) =>
        current
          ? current.map((t) => ({ ...t, isActive: t.id === id }))
          : current,
      );
      onActivated?.(id);
    } catch {
      setError("Unable to activate theme.");
    } finally {
      setActivatingId(null);
    }
  }

  if (themes === null && !error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Active theme
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={`theme-card-skeleton-${i}`}
                className="h-32 animate-pulse rounded-xl border border-border/70 bg-muted/40"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Active theme
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Switch between installed themes without redeploying. Adding a new
          theme still requires registering it in <code>nexpress.config.ts</code>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
            {message}
          </div>
        ) : null}

        {themes && themes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            No themes registered. Add one to{" "}
            <code>nexpress.config.ts</code>'s <code>themes</code> array.
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {(themes ?? []).map((theme) => (
            <article
              key={theme.id}
              data-active={theme.isActive ? "true" : undefined}
              className={`flex flex-col justify-between gap-4 rounded-xl border bg-background/60 p-4 shadow-sm transition ${
                theme.isActive
                  ? "border-primary/60 ring-2 ring-primary/30"
                  : "border-border/70 hover:border-border"
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium leading-tight text-foreground">
                    {theme.name}
                  </h3>
                  {theme.isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  v{theme.version}
                  {theme.author?.name ? ` · ${theme.author.name}` : ""}
                </p>
                {theme.description ? (
                  <p className="text-sm text-muted-foreground">
                    {theme.description}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  variant={theme.isActive ? "outline" : "default"}
                  disabled={theme.isActive || activatingId !== null}
                  onClick={() => void activate(theme.id)}
                >
                  {activatingId === theme.id ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Activating…
                    </>
                  ) : theme.isActive ? (
                    "In use"
                  ) : (
                    "Activate"
                  )}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
