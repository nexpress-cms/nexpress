"use client";

import { lazy, type ComponentType, type Dispatch, type KeyboardEvent } from "react";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { EditorAction } from "../editor-engine/index.js";
import { cn } from "../../ui/utils.js";

import { AutoGrowTextarea } from "./auto-grow-textarea.js";

// Lazy-load the Lexical editor to keep it out of the in-page
// editor's main bundle. Mirrors the lazy-load in field-renderer.tsx
// so collections that don't use rich-text blocks don't pay the
// cost.
const LazyRichTextEditor = lazy(async () => {
  const mod = await import("@nexpress/editor/client");
  return {
    default: mod.NpRichTextEditor as ComponentType<{
      value: unknown;
      onChange: (value: unknown) => void;
      config?: unknown;
    }>,
  };
});

interface BodyProps {
  block: NpBlockInstance;
  meta: NpBlockMetadata;
  dispatch: Dispatch<EditorAction>;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

const update = (dispatch: Dispatch<EditorAction>, id: string, patch: Record<string, unknown>) =>
  dispatch({ type: "UPDATE_PROPS", id, props: patch });

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ParagraphBody({ block, dispatch, onFocus, onKeyDown }: BodyProps) {
  return (
    <AutoGrowTextarea
      value={readString(block.props.text)}
      onChange={(text) => update(dispatch, block.id, { text })}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      placeholder="Type ‘/’ for commands, or write…"
      className="text-[15px] leading-7 text-foreground"
    />
  );
}

function HeadingBody({ block, dispatch, onFocus, onKeyDown }: BodyProps) {
  const levelRaw = block.props.level;
  const level = levelRaw === 1 || levelRaw === 3 ? levelRaw : 2;
  const placeholder = `Heading ${level}`;
  return (
    <AutoGrowTextarea
      value={readString(block.props.text)}
      onChange={(text) => update(dispatch, block.id, { text })}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      // Sizes match the design's `.be-h1` / `.be-h2` / `.be-h3`
      // (26 / 20 / 16 px). Tailwind's preset text-{2xl,xl,base}
      // came in too tall (30 / 24 / 20); use arbitrary values to
      // pin the exact pixel scale the design system specifies.
      className={cn(
        "font-semibold leading-tight text-foreground",
        level === 1 && "text-[26px] tracking-[-0.02em] leading-[1.25]",
        level === 2 && "text-[20px] tracking-[-0.015em] leading-[1.3]",
        level === 3 && "text-[16px] tracking-[-0.01em] leading-[1.35]",
      )}
    />
  );
}

function QuoteBody({ block, dispatch, onFocus, onKeyDown }: BodyProps) {
  return (
    <div className="border-l-2 border-neutral-900 py-1 pl-4 dark:border-neutral-100">
      <AutoGrowTextarea
        value={readString(block.props.text)}
        onChange={(text) => update(dispatch, block.id, { text })}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder="Quote…"
        className="text-[15px] italic leading-7 text-foreground"
      />
    </div>
  );
}

function CodeBody({ block, dispatch, onFocus, onKeyDown }: BodyProps) {
  const lang = readString(block.props.language) || "ts";
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <select
          value={lang}
          onChange={(e) => update(dispatch, block.id, { language: e.target.value })}
          onFocus={onFocus}
          className="rounded border border-neutral-800 bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-neutral-300 outline-none focus:border-primary"
        >
          {["ts", "js", "tsx", "json", "bash", "sql", "text"].map((l) => (
            <option key={l} value={l} className="bg-neutral-900 text-neutral-100">
              {l}
            </option>
          ))}
        </select>
        <span className="font-mono text-[10px] text-neutral-500">⌘↵ run</span>
      </div>
      <AutoGrowTextarea
        value={readString(block.props.code)}
        onChange={(code) => update(dispatch, block.id, { code })}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder="// code…"
        className="px-3.5 py-3 font-mono text-[13px] leading-relaxed text-neutral-100"
      />
    </div>
  );
}

function CalloutBody({ block, dispatch, onFocus, onKeyDown }: BodyProps) {
  const tone = (() => {
    const v = block.props.tone;
    if (v === "warning" || v === "success") return v;
    return "info";
  })();
  const toneClasses = {
    info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100",
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
  } as const;
  const ToneIcon =
    tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle : Info;
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto] gap-3 rounded-lg border px-3 py-2.5",
        toneClasses[tone],
      )}
    >
      <ToneIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <AutoGrowTextarea
        value={readString(block.props.text)}
        onChange={(text) => update(dispatch, block.id, { text })}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder="A note worth highlighting…"
        className="text-[14px] leading-6"
      />
      <div className="flex items-start gap-1 pt-0.5">
        {(["info", "success", "warning"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={`Set tone: ${t}`}
            data-active={tone === t}
            onClick={() => update(dispatch, block.id, { tone: t })}
            className={cn(
              "h-4 w-4 rounded-full border transition",
              t === "info" && "bg-sky-400",
              t === "success" && "bg-emerald-400",
              t === "warning" && "bg-amber-400",
              tone === t
                ? "border-foreground/40 ring-2 ring-foreground/20 ring-offset-1"
                : "border-transparent opacity-60 hover:opacity-100",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ListBody({ block, dispatch, onFocus, onKeyDown }: BodyProps) {
  const items: string[] = Array.isArray(block.props.items)
    ? block.props.items.filter((v): v is string => typeof v === "string")
    : [""];
  const ordered = block.props.ordered === true;
  const setItems = (next: string[]) => update(dispatch, block.id, { items: next });

  return (
    <ul className="flex flex-col gap-1 py-1">
      {items.map((item, i) => (
        <li key={i} className="grid grid-cols-[16px_1fr] items-start gap-2">
          <span
            className={cn(
              "mt-2 h-1 w-1 shrink-0 self-start rounded-full bg-foreground/70",
              ordered &&
                "h-auto w-auto rounded-none font-mono text-[11px] leading-7 text-muted-foreground",
            )}
          >
            {ordered ? `${i + 1}.` : null}
          </span>
          <AutoGrowTextarea
            value={item}
            onChange={(v) => {
              const next = items.slice();
              next[i] = v;
              setItems(next);
            }}
            onFocus={onFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const next = items.slice();
                next.splice(i + 1, 0, "");
                setItems(next);
                return;
              }
              if (e.key === "Backspace" && item === "" && items.length > 1) {
                e.preventDefault();
                const next = items.slice();
                next.splice(i, 1);
                setItems(next);
                return;
              }
              onKeyDown?.(e);
            }}
            placeholder="List item"
            className="text-[14.5px] leading-6"
          />
        </li>
      ))}
    </ul>
  );
}

function ImageBody({ block, dispatch, onFocus }: BodyProps) {
  const src = readString(block.props.src);
  const alt = readString(block.props.alt);
  const caption = readString(block.props.caption);
  return (
    <div className="flex flex-col gap-1.5">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="block max-w-full rounded-lg border border-neutral-200/80 dark:border-neutral-800/80"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center text-muted-foreground dark:border-neutral-700 dark:bg-neutral-900/40">
          <span className="text-sm font-medium text-foreground/80">
            Paste a URL — or pick from media in Page builder.
          </span>
          <input
            type="url"
            value={src}
            onChange={(e) => update(dispatch, block.id, { src: e.target.value })}
            onFocus={onFocus}
            placeholder="https://… or /media/asset.jpg"
            className="w-full rounded-md border border-neutral-200/80 bg-background px-2 py-1 font-mono text-xs outline-none focus:border-primary dark:border-neutral-800/80"
          />
        </div>
      )}
      <input
        type="text"
        value={alt}
        onChange={(e) => update(dispatch, block.id, { alt: e.target.value })}
        onFocus={onFocus}
        placeholder="Alt text (required for accessibility)"
        className="w-full border-0 bg-transparent px-0 text-xs text-muted-foreground outline-none focus:ring-0"
      />
      <input
        type="text"
        value={caption}
        onChange={(e) => update(dispatch, block.id, { caption: e.target.value })}
        onFocus={onFocus}
        placeholder="Caption (optional)"
        className="w-full border-0 bg-transparent px-0 text-center text-xs italic text-muted-foreground outline-none focus:ring-0"
      />
    </div>
  );
}

function DividerBody({ onFocus }: BodyProps) {
  return (
    <div
      tabIndex={0}
      onFocus={onFocus}
      className="my-3 h-px w-full bg-neutral-200 outline-none focus:bg-primary dark:bg-neutral-800"
    />
  );
}

function ComplexBody({ meta, block }: BodyProps) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-700 dark:bg-neutral-900/40">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{meta.label}</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{block.type}</code>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Composite block — switch to Page builder to edit its props.
      </p>
    </div>
  );
}

function RichTextBody({ block, dispatch, onFocus }: BodyProps) {
  // Mark the body container with `data-np-rich-text-body` so the
  // sticky toolbar's `inRichText` detection lights up the inline-
  // mark segment (Bold / Italic / Underline / etc.) when focus
  // lands inside the Lexical contenteditable.
  //
  // The Suspense boundary lives ONE LEVEL UP in `<DocCanvas>` so
  // multiple rich-text rows in the same doc share a single
  // "Loading rich-text editor…" fallback instead of each rendering
  // their own. Once `@nexpress/editor/client` resolves, every
  // `<LazyRichTextEditor>` instance hydrates simultaneously.
  return (
    <div
      data-np-rich-text-body
      onFocusCapture={onFocus}
      className="np-doc-rich-text rounded-lg border border-neutral-200/80 bg-background px-3 py-2 dark:border-neutral-800/80"
    >
      <LazyRichTextEditor
        value={block.props.content ?? null}
        onChange={(content: unknown) =>
          dispatch({
            type: "UPDATE_PROPS",
            id: block.id,
            props: { content },
          })
        }
      />
    </div>
  );
}

export interface BlockBodyRendererProps {
  block: NpBlockInstance;
  meta: NpBlockMetadata | undefined;
  dispatch: Dispatch<EditorAction>;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * Pick the right inline body component for a block instance.
 * Drives off the metadata's `docBodyKind`; defaults to the
 * read-only "complex" placeholder when the metadata is missing
 * or non-Doc-friendly.
 */
export function BlockBodyRenderer({
  block,
  meta,
  dispatch,
  onFocus,
  onKeyDown,
}: BlockBodyRendererProps) {
  if (!meta) {
    return (
      <ComplexBody
        block={block}
        meta={{ type: block.type, label: block.type, defaultProps: {}, propsSchema: [] }}
        dispatch={dispatch}
      />
    );
  }
  const props: BodyProps = { block, meta, dispatch, onFocus, onKeyDown };
  switch (meta.docBodyKind) {
    case "paragraph":
      return <ParagraphBody {...props} />;
    case "heading":
    case "heading-2":
    case "heading-3":
      return <HeadingBody {...props} />;
    case "quote":
      return <QuoteBody {...props} />;
    case "code":
      return <CodeBody {...props} />;
    case "callout":
      return <CalloutBody {...props} />;
    case "list":
      return <ListBody {...props} />;
    case "image":
      return <ImageBody {...props} />;
    case "divider":
      return <DividerBody {...props} />;
    case "rich-text":
      return <RichTextBody {...props} />;
    case "complex":
    default:
      return <ComplexBody {...props} />;
  }
}
