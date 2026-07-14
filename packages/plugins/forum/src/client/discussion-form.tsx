"use client";

import { useRouter } from "next/navigation";
import { Suspense, lazy, useState, type ComponentType } from "react";
import { isNpRichTextContent, npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import type { NpRichTextContent } from "@nexpress/editor";

interface DiscussionFormProps {
  mode: "create" | "edit";
  /** Required when `mode === "edit"`. */
  initial?: {
    docId: string;
    slug: string;
    title: string;
    body: NpRichTextContent | null;
  };
}

const SLUG_RE = /[^a-z0-9]+/g;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}

interface ApiErrorBody {
  error?: { message?: string; details?: Array<{ field?: string; message?: string }> };
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as ApiErrorBody).error;
  if (!err) return null;
  const detail = err.details?.[0]?.message;
  if (typeof detail === "string") return detail;
  if (typeof err.message === "string") return err.message;
  return null;
}

/**
 * Lazy-load the rich-text editor. Mirrors the admin field renderer
 * pattern (see `packages/admin/src/collections/field-renderer.tsx`):
 * the Lexical bundle is heavy, and a member browsing /discussions
 * shouldn't pay for it until they actually click "New discussion".
 */
interface LazyRichTextEditorProps {
  value: NpRichTextContent | null;
  onChange: (value: unknown) => void;
  config?: {
    onUploadImage?: (file: File) => Promise<{ url: string; alt?: string }>;
  };
}

const LazyRichTextEditor = lazy(async () => {
  const module = await import("@nexpress/editor/client");
  return {
    default: module.NpRichTextEditor as ComponentType<LazyRichTextEditorProps>,
  };
});

/**
 * Member-side image uploader. POSTs to the dedicated member
 * endpoint (Phase 9.7j) — image-only, 5 MB cap, banned-member
 * check on the server side. The endpoint resolves the storage URL
 * via `getStorageAdapter().getUrl()` and returns it directly so the
 * editor can insert an `<img src>` that works under both local-disk
 * (`/media/...` by default) and S3 (CDN URL) storage adapters.
 */
async function uploadMemberImage(file: File): Promise<{ url: string }> {
  const csrf = readCookie("np-mb-csrf");
  const headers: Record<string, string> = csrf ? { "X-CSRF-Token": csrf } : {};
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/members/media/upload", {
    method: "POST",
    credentials: "include",
    headers,
    body: formData,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string; details?: Array<{ message?: string }> };
    } | null;
    const detail = body?.error?.details?.[0]?.message;
    const message = detail ?? body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  const json = (await res.json()) as { data?: { url?: string }; url?: string } | null;
  const url = json?.data?.url ?? json?.url ?? null;
  if (!url) throw new Error("Upload succeeded but no URL was returned.");
  return { url };
}

/**
 * Member-side discussion create / edit form. The body field uses
 * the same `NpRichTextEditor` the admin uses for staff-authored
 * posts — paragraphs, headings, bold/italic/underline, lists, links,
 * code, quotes. No image upload yet (would need member-side media
 * permissions; deferred). The editor produces Lexical-shaped JSON
 * directly, so the API body just passes it through to the
 * `richText` field on `discussions`.
 */
export function DiscussionForm({ mode, initial }: DiscussionFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState<NpRichTextContent | null>(initial?.body ?? null);
  // `slug` is only editable on create — server pipeline uses the
  // configured slugField (derives from title) when the body omits
  // slug. We pre-fill from title so the user sees what their URL
  // will look like; they can still override before submitting.
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      };
      const finalSlug = (slug || slugify(title)).trim();
      const payload = {
        title: title.trim(),
        slug: finalSlug || slugify(title),
        // The editor either returns Lexical JSON or stays null when
        // empty. Submit an empty-paragraph shell when null so the
        // server-side renderer has a valid root to walk.
        body: body ?? emptyRichText(),
      };
      const url =
        mode === "create"
          ? "/api/collections/discussions"
          : `/api/collections/discussions/${initial?.docId}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers,
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as {
        id?: string;
        slug?: string;
        status?: string;
        error?: unknown;
      } | null;
      if (!res.ok) {
        setError(extractMessage(json) ?? `HTTP ${res.status}`);
        return;
      }
      const docPayload =
        (json && typeof json === "object" && "data" in json
          ? (json as { data: { id?: string; slug?: string; status?: string } }).data
          : json) ?? null;
      const slugOut = docPayload?.slug ?? finalSlug;
      const status = docPayload?.status;

      // After create, route to the detail page if it's published; if
      // pending (moderation gate), route back to the list with a
      // `?author=me` filter so the author can see their submission
      // in the queue.
      if (mode === "create" && status === "pending") {
        router.push("/discussions?author=me");
        router.refresh();
        return;
      }
      router.push(`/discussions/${slugOut}`);
      router.refresh();
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="np-discussion-form"
    >
      {error ? (
        <div role="alert" className="np-form-error">
          {error}
        </div>
      ) : null}

      <label className="np-form-field">
        <span className="np-form-label">Title</span>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => {
            const next = e.target.value;
            setTitle(next);
            // Auto-derive slug from title until the user manually
            // edits it. Once they do, we stop overwriting.
            if (mode === "create" && (slug === "" || slug === slugify(title))) {
              setSlug(slugify(next));
            }
          }}
          maxLength={200}
          disabled={submitting}
          className="np-form-input"
        />
      </label>

      {mode === "create" ? (
        <label className="np-form-field">
          <span className="np-form-label">Slug (URL)</span>
          <input
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="[a-z0-9-]+"
            maxLength={80}
            disabled={submitting}
            className="np-form-input"
          />
          <small className="np-form-help">Lowercase letters, digits, and hyphens.</small>
        </label>
      ) : null}

      <div className="np-form-field">
        <span className="np-form-label">Body</span>
        <Suspense
          fallback={
            <div className="np-form-editor-loading" role="status">
              Loading editor…
            </div>
          }
        >
          <LazyRichTextEditor
            value={body}
            onChange={(value) => {
              // The editor's onChange signature is `(value: unknown)`
              // because the admin field-renderer uses `react-hook-form`
              // and accepts whatever the editor emits. Here we know
              // the shape — Lexical JSON or null — so we narrow.
              setBody(isNpRichTextContent(value) ? value : null);
            }}
            config={{ onUploadImage: uploadMemberImage }}
          />
        </Suspense>
      </div>

      <div className="np-form-actions">
        <button type="submit" className="np-button-primary" disabled={submitting || !title.trim()}>
          {submitting
            ? mode === "create"
              ? "Posting…"
              : "Saving…"
            : mode === "create"
              ? "Post discussion"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}

/**
 * The editor returns null when the user hasn't typed anything; the
 * collection contract requires a complete v1 envelope. Submit the shared
 * empty document so the row remains valid on its way to render.
 */
function emptyRichText(): NpRichTextContent {
  return npCreateEmptyRichTextContent();
}
