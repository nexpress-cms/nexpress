"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Input } from "../../ui/input.js";

/**
 * Two-mode image input: paste a URL directly (escape hatch for
 * external CDNs and remote assets) OR pick from the media
 * library. Stores a URL string — block renders use the URL
 * directly in `<img src=...>` / `background-image: url(...)`.
 *
 * Library features (#467 follow-ups):
 * - Server-side substring search via `/api/media?q=` (ILIKE
 *   over filename + alt).
 * - Page-based "Load more" pagination.
 * - In-dialog upload with concurrency cap so a 100-file drop
 *   doesn't open 100 parallel POSTs.
 * - Broken-image state on the inline preview.
 * - AbortController on rapid query changes.
 */

export interface BlockImagePickerProps {
  inputId: string;
  value: string;
  onChange: (next: string) => void;
}

interface MediaDoc {
  id: string;
  url?: string;
  filename?: string;
  alt?: string;
}

const PAGE_SIZE = 24;
const UPLOAD_CONCURRENCY = 3;

export function BlockImagePicker({ inputId, value, onChange }: BlockImagePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<MediaDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewBroken, setPreviewBroken] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  // Debounce query to avoid hammering the media API on every
  // keystroke while still feeling responsive.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Reset broken-state when the URL changes — operator may have
  // pasted a valid URL after a broken one. The <img onError> hook
  // re-flips it to true if the new URL also fails.
  useEffect(() => {
    setPreviewBroken(false);
  }, [value]);

  const loadMedia = useCallback(async (page: number, query: string, mode: "replace" | "append") => {
    // Cancel any in-flight request so a slow earlier query can't
    // overwrite the response from a newer query.
    if (loadAbortRef.current) loadAbortRef.current.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(page));
    const trimmed = query.trim();
    if (trimmed.length > 0) params.set("q", trimmed);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/media?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Media load failed (${res.status})`);
      const payload = (await res.json()) as {
        docs?: MediaDoc[];
        totalDocs?: number;
        totalPages?: number;
        page?: number;
      };
      const next = Array.isArray(payload.docs) ? payload.docs : [];
      setItems((prev) => (mode === "append" ? [...prev, ...next] : next));
      const totalPages = typeof payload.totalPages === "number" ? payload.totalPages : page;
      setHasMore(page < totalPages);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load media.");
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Reset + load page 1 when the dialog opens OR the debounced
  // query changes. Server applies the filter so we re-fetch
  // instead of slicing the loaded page client-side.
  useEffect(() => {
    if (!open) return;
    void loadMedia(1, debouncedQuery, "replace");
  }, [open, debouncedQuery, loadMedia]);

  const currentPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const files = Array.from(fileList);
      type UploadOutcome =
        | { status: "fulfilled"; value: string | null }
        | { status: "rejected"; reason: unknown };
      const results: UploadOutcome[] = new Array(files.length);
      const uploadOne = async (file: File): Promise<string | null> => {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/media", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        });
        if (!res.ok) {
          throw new Error(`Upload failed (${res.status})`);
        }
        const doc = (await res.json()) as { doc?: MediaDoc };
        return doc.doc?.url ?? null;
      };
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, files.length) },
        async () => {
          while (true) {
            const index = cursor++;
            if (index >= files.length) return;
            const file = files[index];
            try {
              const value = await uploadOne(file);
              results[index] = { status: "fulfilled", value };
            } catch (reason) {
              results[index] = { status: "rejected", reason };
            }
          }
        },
      );
      await Promise.all(workers);
      const failures = results.filter((r) => r.status === "rejected");
      const successfulUrls = results
        .filter((r): r is { status: "fulfilled"; value: string | null } => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((url): url is string => typeof url === "string");
      const lastUrl = successfulUrls[successfulUrls.length - 1];
      if (lastUrl) onChange(lastUrl);
      if (failures.length > 0) {
        setError(
          failures.length === files.length
            ? "All uploads failed."
            : `${failures.length} of ${files.length} uploads failed.`,
        );
      }
      await loadMedia(1, debouncedQuery, "replace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="url"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder="https://… or pick from library"
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Library
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
            aria-label="Remove image"
          >
            Remove
          </Button>
        ) : null}
      </div>
      {value ? (
        <div className="overflow-hidden rounded-md border border-border/60 bg-muted/20">
          {previewBroken ? (
            <div className="flex h-32 items-center justify-center px-3 text-xs text-amber-600 dark:text-amber-400">
              Image preview failed to load. Check the URL or pick from the library.
            </div>
          ) : (
            <img
              src={value}
              alt=""
              className="block max-h-32 w-full object-cover"
              onError={() => setPreviewBroken(true)}
            />
          )}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select an image</DialogTitle>
            <DialogDescription>
              Search the library, upload a new file, or paste a URL above.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search by filename or alt text"
              className="h-8 flex-1"
              autoFocus
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUploadFiles(e.currentTarget.files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <div className="grid max-h-[28rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
            {items.length === 0 && !loading ? (
              <div className="col-span-full px-2 py-6 text-center text-xs text-muted-foreground">
                {debouncedQuery
                  ? "No assets match your search."
                  : "Library is empty. Use Upload to add an image."}
              </div>
            ) : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.url) onChange(item.url);
                  setOpen(false);
                }}
                className="flex flex-col gap-1 overflow-hidden rounded-md border border-border/60 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {item.url ? (
                  <img
                    src={item.url}
                    alt={item.alt ?? item.filename ?? ""}
                    className="block aspect-video w-full bg-muted object-cover"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                    no preview
                  </div>
                )}
                <p className="truncate px-2 pb-2 text-xs">{item.filename ?? item.id}</p>
              </button>
            ))}
          </div>
          <DialogFooter className="justify-between sm:justify-between">
            <div className="flex items-center gap-2">
              {hasMore ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => void loadMedia(currentPage + 1, debouncedQuery, "append")}
                >
                  {loading ? "Loading…" : "Load more"}
                </Button>
              ) : null}
              {loading && !hasMore ? (
                <span className="text-xs text-muted-foreground">Loading…</span>
              ) : null}
            </div>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
