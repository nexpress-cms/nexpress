"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Sparkles } from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { ThemeReseedDialog } from "./theme-reseed-dialog.js";

/**
 * Phase 11.4 — admin theme switcher.
 *
 * Lists every theme registered in `nexpress.config.ts` (read
 * from `/api/admin/themes`) and lets an admin activate one
 * with a click. The chosen id is persisted to
 * `np_settings.activeTheme` via `PUT /api/admin/themes/active`,
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
  /** Phase F.1 — manifest.requires check result. */
  requirements?: {
    hasMismatches: boolean;
    hasHardMismatches: boolean;
    missingCollections: Array<{ collection: string; createIfAbsent: boolean }>;
    missingFields: Array<{
      collection: string;
      field: string;
      hard: boolean;
    }>;
    typeConflicts: Array<{
      collection: string;
      field: string;
      expected: string;
      actual: string;
      hard: boolean;
    }>;
    relationConflicts: Array<{
      collection: string;
      field: string;
      hard: boolean;
    }>;
  };
}

interface ActiveThemeFallbackNotice {
  persistedActiveId: string;
  activeId: string | null;
}

function summarizeMismatches(req: NonNullable<ThemeSummary["requirements"]>): string {
  const parts: string[] = [];
  if (req.missingCollections.length > 0) {
    parts.push(
      `${req.missingCollections.length} missing collection${
        req.missingCollections.length === 1 ? "" : "s"
      }`,
    );
  }
  if (req.missingFields.length > 0) {
    parts.push(
      `${req.missingFields.length} missing field${req.missingFields.length === 1 ? "" : "s"}`,
    );
  }
  if (req.typeConflicts.length > 0) {
    parts.push(
      `${req.typeConflicts.length} type conflict${req.typeConflicts.length === 1 ? "" : "s"}`,
    );
  }
  if (req.relationConflicts.length > 0) {
    parts.push(
      `${req.relationConflicts.length} relation conflict${
        req.relationConflicts.length === 1 ? "" : "s"
      }`,
    );
  }
  return parts.join(", ");
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
  const [fallbackNotice, setFallbackNotice] = useState<ActiveThemeFallbackNotice | null>(null);
  // v0.3 (E) — after a successful theme switch, show a hint
  // pointing to the cleanup tool. The previous theme's
  // contributed blocks are still in the page-tree; the render
  // layer shows them as placeholder cards until the operator
  // strips them via /admin/themes/cleanup.
  const [showCleanupHint, setShowCleanupHint] = useState(false);
  const [reseedTarget, setReseedTarget] = useState<ThemeSummary | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      const res = await npFetch("/api/admin/themes");
      const payload = (await res.json().catch(() => null)) as {
        docs?: ThemeSummary[];
        activeId?: string | null;
        persistedActiveId?: string | null;
        activeFallbackReason?: "unset" | "missing" | null;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(payload?.error?.message ?? "Unable to load themes.");
        return;
      }
      setThemes(payload?.docs ?? []);
      if (payload?.activeFallbackReason === "missing" && payload.persistedActiveId) {
        setFallbackNotice({
          persistedActiveId: payload.persistedActiveId,
          activeId: payload.activeId ?? null,
        });
      } else {
        setFallbackNotice(null);
      }
    } catch {
      setError("Unable to load themes.");
    }
  }

  async function activate(id: string) {
    setActivatingId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await npFetch("/api/admin/themes/active", {
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
      const previousActive = themes?.find((t) => t.isActive && t.id !== id);
      setMessage(
        activated
          ? `Activated ${activated.name}. The public site will pick it up on the next request.`
          : "Theme activated.",
      );
      // Only show the hint when there WAS a previous active
      // theme (skip on first-boot where no prior theme
      // contributed blocks to clean up).
      if (previousActive) setShowCleanupHint(true);
      setFallbackNotice(null);
      // Update local state optimistically; a full refetch is
      // unnecessary because the server confirmed the new id.
      setThemes((current) =>
        current ? current.map((t) => ({ ...t, isActive: t.id === id })) : current,
      );
      onActivated?.(id);
    } catch {
      setError("Unable to activate theme.");
    } finally {
      setActivatingId(null);
    }
  }

  const fallbackThemeName =
    fallbackNotice?.activeId && themes
      ? themes.find((theme) => theme.id === fallbackNotice.activeId)?.name
      : null;

  if (themes === null && !error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex min-w-0 items-center gap-2">
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
      <CardHeader className="min-w-0">
        <CardTitle className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Active theme
        </CardTitle>
        <p className="break-words text-sm text-muted-foreground">
          Switch between installed themes without redeploying. Adding a new theme still requires
          registering it in <code className="break-all">nexpress.config.ts</code>.
        </p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
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
        {showCleanupHint ? (
          <div className="min-w-0 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <p className="font-medium">Theme switched — check for stale blocks?</p>
            <p className="mt-1 break-words text-xs opacity-80">
              The previous theme may have contributed blocks (e.g.{" "}
              <code className="break-all font-mono">magazine.hero-feature</code>) that are still
              embedded in your pages. The public site shows them as placeholder cards until you run
              cleanup.{" "}
              <a
                href="/admin/themes/cleanup"
                className="underline underline-offset-2 hover:no-underline"
              >
                Open cleanup tool →
              </a>
            </p>
          </div>
        ) : null}

        {fallbackNotice ? (
          <div className="min-w-0 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <p className="font-medium">Previously active theme is no longer registered.</p>
            <p className="mt-1 break-words text-xs opacity-80">
              <code className="break-all font-mono">{fallbackNotice.persistedActiveId}</code> is
              still saved as the active theme, but it is no longer present in{" "}
              <code className="break-all font-mono">nexpress.config.ts</code>. The public site is
              rendering{" "}
              {fallbackThemeName ? (
                <span className="font-medium">{fallbackThemeName}</span>
              ) : (
                "the first registered theme"
              )}{" "}
              until you activate a registered theme below.
            </p>
          </div>
        ) : null}

        {themes && themes.length === 0 ? (
          <div className="break-words rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            No themes registered. Add one to <code className="break-all">nexpress.config.ts</code>
            {"'s "}
            <code className="break-all">themes</code> array.
          </div>
        ) : null}

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {(themes ?? []).map((theme) => (
            <article
              key={theme.id}
              data-active={theme.isActive ? "true" : undefined}
              className={`flex min-w-0 flex-col justify-between gap-4 rounded-xl border bg-background/60 p-4 shadow-sm transition ${
                theme.isActive
                  ? "border-primary/60 ring-2 ring-primary/30"
                  : "border-border/70 hover:border-border"
              }`}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  <h3 className="min-w-0 break-words font-medium leading-tight text-foreground">
                    {theme.name}
                  </h3>
                  {theme.isActive ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  ) : null}
                  {theme.requirements?.hasMismatches ? (
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        theme.requirements.hasHardMismatches
                          ? "bg-destructive/10 text-destructive"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      }`}
                      title={summarizeMismatches(theme.requirements)}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {theme.requirements.hasHardMismatches
                        ? "Requirements unmet"
                        : "Soft requirements"}
                    </span>
                  ) : null}
                </div>
                <p className="break-words text-xs text-muted-foreground">
                  v{theme.version}
                  {theme.author?.name ? ` · ${theme.author.name}` : ""}
                </p>
                {theme.description ? (
                  <p className="break-words text-sm text-muted-foreground">{theme.description}</p>
                ) : null}
                {theme.requirements?.hasMismatches ? (
                  <p
                    className={`break-words text-xs ${
                      theme.requirements.hasHardMismatches
                        ? "text-destructive"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {summarizeMismatches(theme.requirements)}.{" "}
                    {theme.requirements.typeConflicts.length > 0 ||
                    theme.requirements.relationConflicts.length > 0 ? (
                      <>
                        Resolve the conflicting field types in your{" "}
                        <code className="break-all rounded bg-muted px-1 py-0.5 text-[10px]">
                          src/collections/*.ts
                        </code>{" "}
                        — the framework auto-merges theme-declared fields, but an operator-defined
                        field with a different type wins and needs a manual fix.
                      </>
                    ) : (
                      <>
                        Run{" "}
                        <code className="break-all rounded bg-muted px-1 py-0.5 text-[10px]">
                          pnpm db:generate && pnpm db:migrate
                        </code>{" "}
                        to materialise theme-declared columns.
                      </>
                    )}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2 sm:flex sm:items-center sm:justify-between">
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:justify-start"
                  onClick={() => setReseedTarget(theme)}
                  title={
                    theme.isActive
                      ? "Wipe seed-marked demo content and replace with this theme's seed."
                      : "Switch to this theme and replace the previous theme's seed with this one's."
                  }
                >
                  <RotateCcw className="h-3 w-3" />
                  {theme.isActive ? "Reseed demo" : "Switch & reseed"}
                </button>
                <Button
                  size="sm"
                  variant={theme.isActive ? "outline" : "default"}
                  disabled={theme.isActive || activatingId !== null}
                  onClick={() => void activate(theme.id)}
                  className="w-full sm:w-auto"
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
      {reseedTarget ? (
        <ThemeReseedDialog
          open={reseedTarget !== null}
          onOpenChange={(open) => {
            if (!open) setReseedTarget(null);
          }}
          targetThemeId={reseedTarget.id}
          targetThemeName={reseedTarget.name}
          isCurrentlyActive={reseedTarget.isActive}
          onReseedComplete={(result) => {
            setMessage(
              `Reseed complete — activated ${reseedTarget.name}. ${result.wiped.pages + result.wiped.posts} rows wiped, ${result.seeded.pages.created + result.seeded.posts.created} rows seeded.`,
            );
            // Optimistic local update so the panel flips
            // immediately while the refetch is in-flight.
            setThemes((current) =>
              current
                ? current.map((t) => ({
                    ...t,
                    isActive: t.id === result.activeId,
                  }))
                : current,
            );
            // Refetch the full themes list so any state that
            // changed concurrently (another tab's reseed, a
            // theme setting edit) reconciles instead of drifting
            // off the in-memory snapshot.
            void load();
            setFallbackNotice(null);
            onActivated?.(result.activeId);
          }}
        />
      ) : null}
    </Card>
  );
}
