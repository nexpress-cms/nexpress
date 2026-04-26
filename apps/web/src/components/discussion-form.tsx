"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NxRichTextContent } from "@nexpress/editor";

interface DiscussionFormProps {
  mode: "create" | "edit";
  /** Required when `mode === "edit"`. */
  initial?: {
    docId: string;
    slug: string;
    title: string;
    body: NxRichTextContent | null;
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
 * Member-side discussion create / edit form. v1 keeps the body as a
 * plain text field that we wrap in a minimal Lexical-shaped JSON
 * payload — the rich-text editor (`@nexpress/editor/client`) would
 * be heavier than this MVP needs. The server pipeline accepts the
 * shape because `body` is a `richText` field with no required
 * structure constraints.
 */
export function DiscussionForm({ mode, initial }: DiscussionFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [bodyText, setBodyText] = useState(() =>
    initial?.body ? extractPlainText(initial.body) : "",
  );
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
      const csrf = readCookie("nx-mb-csrf");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      };
      const finalSlug = (slug || slugify(title)).trim();
      const body = {
        title: title.trim(),
        slug: finalSlug || slugify(title),
        body: textToRichText(bodyText),
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
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { id?: string; slug?: string; status?: string; error?: unknown }
        | null;
      if (!res.ok) {
        setError(extractMessage(json) ?? `HTTP ${res.status}`);
        return;
      }
      const docPayload = (json && typeof json === "object" && "data" in json
        ? (json as { data: { id?: string; slug?: string; status?: string } }).data
        : (json as { id?: string; slug?: string; status?: string } | null)) ?? null;
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
      className="nx-discussion-form"
    >
      {error ? (
        <div role="alert" className="nx-form-error">
          {error}
        </div>
      ) : null}

      <label className="nx-form-field">
        <span className="nx-form-label">Title</span>
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
          className="nx-form-input"
        />
      </label>

      {mode === "create" ? (
        <label className="nx-form-field">
          <span className="nx-form-label">Slug (URL)</span>
          <input
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="[a-z0-9-]+"
            maxLength={80}
            disabled={submitting}
            className="nx-form-input"
          />
          <small className="nx-form-help">Lowercase letters, digits, and hyphens.</small>
        </label>
      ) : null}

      <label className="nx-form-field">
        <span className="nx-form-label">Body</span>
        <textarea
          rows={10}
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          disabled={submitting}
          className="nx-form-textarea"
        />
      </label>

      <div className="nx-form-actions">
        <button type="submit" className="nx-button-primary" disabled={submitting || !title.trim()}>
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
 * Wrap a plain text string in a minimal Lexical-shaped JSON tree so
 * the rich-text field accepts it. Splits on blank lines into
 * paragraphs. The full editor lands in 9.7g.
 */
function textToRichText(text: string): NxRichTextContent {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    root: {
      type: "root",
      children: paragraphs.map((p) => ({
        type: "paragraph",
        children: [{ type: "text", text: p }],
      })),
    },
  } as unknown as NxRichTextContent;
}

interface RichTextNode {
  type?: string;
  text?: string;
  children?: RichTextNode[];
}

function extractPlainText(content: NxRichTextContent | null): string {
  if (!content) return "";
  const root = (content as unknown as { root?: RichTextNode }).root;
  if (!root) return "";
  const collect = (node: RichTextNode): string => {
    if (typeof node.text === "string") return node.text;
    if (Array.isArray(node.children)) {
      return node.children.map(collect).join(node.type === "paragraph" ? "\n\n" : "");
    }
    return "";
  };
  // Walk the root's children with paragraph separators.
  if (Array.isArray(root.children)) {
    return root.children.map(collect).filter(Boolean).join("\n\n");
  }
  return collect(root);
}
