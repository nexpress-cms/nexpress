"use client";

import { isNpRichTextContent, npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import type { NpRichTextContent } from "@nexpress/editor";
import { useRouter } from "next/navigation";
import { Suspense, lazy, useState, type ComponentType } from "react";

interface ForumPostFormProps {
  mode: "create" | "edit";
  basePath: string;
  collectionSlug: string;
  board: {
    id: string;
    key: string;
    categories: Array<{ key: string; label: string }>;
  };
  initial?: {
    postId: string;
    title: string;
    body: NpRichTextContent | null;
    category: string | null;
  };
  labels: {
    category: string;
    categoryNone: string;
    title: string;
    body: string;
    loadingEditor: string;
    saving: string;
    create: string;
    save: string;
    saveFailed: string;
  };
}

interface LazyRichTextEditorProps {
  value: NpRichTextContent | null;
  onChange: (value: unknown) => void;
  config?: { onUploadImage?: (file: File) => Promise<{ url: string; alt?: string }> };
}

const LazyRichTextEditor = lazy(async () => {
  const module = await import("@nexpress/editor/client");
  return {
    default: module.NpRichTextEditor as ComponentType<LazyRichTextEditorProps>,
  };
});

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}

function extractError(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = (body as { error?: { message?: unknown; details?: Array<{ message?: unknown }> } })
    .error;
  const detail = error?.details?.[0]?.message;
  if (typeof detail === "string") return detail;
  return typeof error?.message === "string" ? error.message : null;
}

async function uploadMemberImage(file: File): Promise<{ url: string }> {
  const csrf = readCookie("np-mb-csrf");
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/members/media/upload", {
    method: "POST",
    credentials: "include",
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
    body: formData,
  });
  const result = (await response.json().catch(() => null)) as {
    data?: { url?: unknown };
    url?: unknown;
  } | null;
  if (!response.ok) throw new Error(extractError(result) ?? `HTTP ${response.status}`);
  const url = result?.data?.url ?? result?.url;
  if (typeof url !== "string") throw new Error("Upload succeeded without a media URL.");
  return { url };
}

export function ForumPostForm({
  mode,
  basePath,
  collectionSlug,
  board,
  initial,
  labels,
}: ForumPostFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState<NpRichTextContent | null>(initial?.body ?? null);
  const [category, setCategory] = useState(initial?.category ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch(
        mode === "create"
          ? `/api/collections/${collectionSlug}`
          : `/api/collections/${collectionSlug}/${initial?.postId ?? ""}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          },
          body: JSON.stringify({
            board: board.id,
            title: title.trim(),
            body: body ?? npCreateEmptyRichTextContent(),
            category: category || null,
          }),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        data?: { id?: unknown; status?: unknown };
        id?: unknown;
        status?: unknown;
      } | null;
      if (!response.ok) {
        setError(extractError(json) ?? `HTTP ${response.status}`);
        return;
      }
      const result = json?.data ?? json;
      if (mode === "create" && result?.status === "pending") {
        router.push(`${basePath}/${board.key}?author=me`);
      } else {
        const postId = typeof result?.id === "string" ? result.id : initial?.postId;
        router.push(postId ? `${basePath}/${board.key}/${postId}` : `${basePath}/${board.key}`);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.saveFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="np-forum-post-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {error ? (
        <p role="alert" className="np-form-error">
          {error}
        </p>
      ) : null}
      {board.categories.length > 0 ? (
        <label className="np-form-field">
          <span className="np-form-label">{labels.category}</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={submitting}
            className="np-form-input"
          >
            <option value="">{labels.categoryNone}</option>
            {board.categories.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="np-form-field">
        <span className="np-form-label">{labels.title}</span>
        <input
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={submitting}
          className="np-form-input"
        />
      </label>
      <div className="np-form-field">
        <span className="np-form-label">{labels.body}</span>
        <Suspense
          fallback={
            <div className="np-form-editor-loading" role="status">
              {labels.loadingEditor}
            </div>
          }
        >
          <LazyRichTextEditor
            value={body}
            onChange={(value) => setBody(isNpRichTextContent(value) ? value : null)}
            config={{ onUploadImage: uploadMemberImage }}
          />
        </Suspense>
      </div>
      <div className="np-form-actions">
        <button type="submit" className="np-button-primary" disabled={submitting || !title.trim()}>
          {submitting ? labels.saving : mode === "create" ? labels.create : labels.save}
        </button>
      </div>
    </form>
  );
}
