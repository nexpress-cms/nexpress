"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";

/**
 * Destructive confirmation for the reseed flow.
 *
 * Opens from the theme-switcher's "Switch & reseed" link (or
 * "Reseed demo content" when the target is already active),
 * fetches a preview of what would change via
 * `GET /api/admin/themes/reseed?themeId=X`, and lets the
 * operator confirm. On confirm, POSTs to the same endpoint.
 *
 * Always shows the **outgoing** seed-marked counts ("X pages
 * and Y posts will be removed"). Surfaces a separate notice
 * when legacy unmarked rows exist (pre-0.2 installs) — those
 * are NOT deleted, and the operator may end up with both the
 * old default-theme home page AND the new theme's home page
 * fighting for the same slug. The notice points to the
 * separate cleanup tool for legacy rows.
 *
 * The dialog component is stateful but bound to the
 * controlling props (`open`, `onOpenChange`) so the parent
 * owns visibility. The parent also passes `targetThemeId` +
 * `targetThemeName`; the dialog fetches everything else.
 */

interface PreviewCounts {
  target: { id: string; name: string } | null;
  seedMarked: { pages: number; posts: number };
  legacyUnmarked: { pages: number; posts: number };
}

interface ReseedResult {
  activeId: string;
  wiped: { pages: number; posts: number };
  seeded: {
    pages: { created: number; skipped: boolean };
    posts: { created: number; skipped: boolean };
    terms: {
      tagsCreated: number;
      categoriesCreated: number;
      skipped: boolean;
    };
    navigation: {
      header: number;
      footer: number;
      headerSkipped: boolean;
      footerSkipped: boolean;
    };
  };
}

export interface ThemeReseedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetThemeId: string;
  targetThemeName: string;
  isCurrentlyActive: boolean;
  onReseedComplete?: (result: ReseedResult) => void;
}

function formatErrorDetails(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const lines: string[] = [];
  for (const item of details) {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const field = typeof obj.field === "string" ? obj.field : null;
      const path = Array.isArray(obj.path) ? obj.path.join(".") : null;
      const message = typeof obj.message === "string" ? obj.message : null;
      const label = field ?? path;
      if (label && message) lines.push(`• ${label}: ${message}`);
      else if (message) lines.push(`• ${message}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function ThemeReseedDialog({
  open,
  onOpenChange,
  targetThemeId,
  targetThemeName,
  isCurrentlyActive,
  onReseedComplete,
}: ThemeReseedDialogProps) {
  const [preview, setPreview] = useState<PreviewCounts | null>(null);
  const [phase, setPhase] = useState<"preview" | "running" | "done" | "error">("preview");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReseedResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPhase("preview");
    setPreview(null);
    setResult(null);
    setError(null);
    void (async () => {
      try {
        const res = await npFetch(
          `/api/admin/themes/reseed?themeId=${encodeURIComponent(targetThemeId)}`,
          { signal: controller.signal },
        );
        const payload = (await res.json().catch(() => null)) as
          | (PreviewCounts & { error?: { message?: string } })
          | null;
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setError(payload?.error?.message ?? "Unable to read current state.");
          setPhase("error");
          return;
        }
        if (!payload || !payload.seedMarked || !payload.legacyUnmarked) {
          setError("Empty preview response.");
          setPhase("error");
          return;
        }
        setPreview({
          target: payload.target,
          seedMarked: payload.seedMarked,
          legacyUnmarked: payload.legacyUnmarked,
        });
      } catch (err) {
        // AbortError when the dialog closed mid-flight — not a
        // real failure, just skip the setState.
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Unable to read current state.");
        setPhase("error");
      }
    })();
    return () => {
      controller.abort();
    };
  }, [open, targetThemeId]);

  async function runReseed() {
    setPhase("running");
    setError(null);
    try {
      const res = await npFetch("/api/admin/themes/reseed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: targetThemeId }),
      });
      const payload = (await res.json().catch(() => null)) as
        | (ReseedResult & {
            error?: {
              message?: string;
              details?: unknown;
            };
          })
        | null;
      if (!res.ok) {
        const detailLines = formatErrorDetails(payload?.error?.details);
        const top = payload?.error?.message ?? "Reseed failed.";
        setError(detailLines ? `${top}\n${detailLines}` : top);
        setPhase("error");
        return;
      }
      if (!payload || !payload.activeId || !payload.wiped || !payload.seeded) {
        setError("Empty reseed response.");
        setPhase("error");
        return;
      }
      setResult({
        activeId: payload.activeId,
        wiped: payload.wiped,
        seeded: payload.seeded,
      });
      setPhase("done");
      onReseedComplete?.(payload);
    } catch {
      setError("Reseed request failed.");
      setPhase("error");
    }
  }

  const title = isCurrentlyActive
    ? `Reseed ${targetThemeName} demo content`
    : `Switch to ${targetThemeName} and reseed`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription className="break-words">
            Destructive — seed-marked demo content will be deleted before the new theme's content is
            written. Operator-authored pages and posts are not touched.
          </DialogDescription>
        </DialogHeader>

        {phase === "preview" && preview ? (
          <div className="min-w-0 space-y-3 text-sm">
            <div className="min-w-0 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <p className="break-words font-medium text-foreground">
                {preview.seedMarked.pages} page
                {preview.seedMarked.pages === 1 ? "" : "s"} + {preview.seedMarked.posts} post
                {preview.seedMarked.posts === 1 ? "" : "s"} will be deleted
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                These are rows the seeder created (carrying a{" "}
                <code className="break-all font-mono">seed_source</code> marker). Your own pages and
                posts stay.
              </p>
            </div>
            {preview.legacyUnmarked.pages > 0 || preview.legacyUnmarked.posts > 0 ? (
              <div className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <p className="min-w-0 break-words">
                  {preview.legacyUnmarked.pages + preview.legacyUnmarked.posts} row
                  {preview.legacyUnmarked.pages + preview.legacyUnmarked.posts === 1 ? "" : "s"} on
                  this site carry no <code className="break-all">seed_source</code> marker — they
                  may be operator-authored content, or legacy demo data from pre-0.2 installs.
                  Reseed will leave them alone; if any share a slug with the new theme's pages, the
                  seed will fail on the unique-slug constraint. Move them to the trash first if you
                  hit that.
                </p>
              </div>
            ) : null}
            <p className="break-words text-xs text-muted-foreground">
              The new theme's <code className="break-all">seedContent</code> will then be written
              {isCurrentlyActive ? "." : ", and the active theme will switch to "}
              {isCurrentlyActive ? null : (
                <strong className="break-words text-foreground">{targetThemeName}</strong>
              )}
              {isCurrentlyActive ? null : "."}
            </p>
          </div>
        ) : null}

        {phase === "running" ? <RunningIndicator preview={preview} /> : null}

        {phase === "done" && result ? (
          <div className="min-w-0 space-y-2 text-sm">
            <div className="min-w-0 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-emerald-700 dark:text-emerald-300">
              <p className="font-medium">Reseed complete.</p>
              <p className="mt-1 break-words text-xs">
                Deleted {result.wiped.pages} page
                {result.wiped.pages === 1 ? "" : "s"} + {result.wiped.posts} post
                {result.wiped.posts === 1 ? "" : "s"}. Wrote {result.seeded.pages.created} page
                {result.seeded.pages.created === 1 ? "" : "s"}, {result.seeded.posts.created} post
                {result.seeded.posts.created === 1 ? "" : "s"}, {result.seeded.terms.tagsCreated}{" "}
                tag
                {result.seeded.terms.tagsCreated === 1 ? "" : "s"} +{" "}
                {result.seeded.terms.categoriesCreated} categor
                {result.seeded.terms.categoriesCreated === 1 ? "y" : "ies"}.
              </p>
            </div>
            <p className="break-words text-xs text-muted-foreground">
              The public site picks up the new theme on the next request — caches were busted
              automatically.
            </p>
          </div>
        ) : null}

        {phase === "error" && error ? (
          <div className="whitespace-pre-line break-words rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          {phase === "done" ? (
            <DialogClose asChild>
              <Button variant="default">Close</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="ghost" disabled={phase === "running"}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={phase !== "preview" || preview === null}
                onClick={() => void runReseed()}
              >
                {phase === "running" ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Reseeding…
                  </>
                ) : (
                  "Wipe & reseed"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * In-flight indicator for the reseed POST. Splits the work into
 * named phases (wipe, then seed) and switches the label based on
 * elapsed time. Numbers are advisory — the server runs the work
 * as one call so there's no real phase signal — but the wipe is
 * always quick (hooks + delete per row) and the seed is the
 * longer half (writes + Lexical processing). The split message
 * tells the operator the dialog isn't hung when the spinner
 * sits there for 6 seconds.
 *
 * Includes a row-count breakdown pulled from the GET preview so
 * the operator sees "wiping 14 rows" instead of an opaque
 * "wiping…". Falls back to a generic label if preview was null.
 */
function RunningIndicator({ preview }: { preview: PreviewCounts | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const wipeCount = preview ? preview.seedMarked.pages + preview.seedMarked.posts : null;
  const totalWork = wipeCount ?? 0;
  // Roughly: wipe phase lasts 1s per 30 rows (each delete fires
  // hooks). Switch the message after that budget elapses, with a
  // small floor so even a 0-row wipe gets a "wiping" beat.
  const wipeBudgetSec = Math.max(2, Math.ceil(totalWork / 30));
  const phaseLabel =
    elapsed < wipeBudgetSec
      ? wipeCount !== null
        ? `Wiping ${wipeCount} seed row${wipeCount === 1 ? "" : "s"}…`
        : "Wiping seed content…"
      : "Writing new theme content…";

  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="min-w-0 break-words">{phaseLabel}</span>
      </div>
      <p className="break-words text-xs">
        This usually takes 5–10 seconds. Keep the tab open until it finishes.
      </p>
    </div>
  );
}
