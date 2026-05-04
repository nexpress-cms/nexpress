import { useEffect, useState, type ReactNode } from "react";

import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { TOGGLE_LINK_COMMAND, $isLinkNode } from "@lexical/link";
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, $isListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $findMatchingParent,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
} from "lexical";
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";

import { $createImageNode } from "./image-node.js";

interface ToolbarPluginProps {
  /**
   * Optional async file uploader. When provided, the Insert Image
   * dialog shows a file picker that pipes the chosen file through
   * this callback and inserts the resulting URL as an `ImageNode`.
   * When omitted, the dialog falls back to URL-only.
   */
  onUploadImage?: (file: File) => Promise<{ url: string; alt?: string }>;
}

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code" | "bullet" | "number";

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  link: boolean;
  blockType: BlockType;
}

const DEFAULT_STATE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  link: false,
  blockType: "paragraph",
};

function getBlockType(): Pick<ToolbarState, "blockType" | "link"> {
  const selection = $getSelection();

  if (!$isRangeSelection(selection)) {
    return { blockType: "paragraph", link: false };
  }

  const anchorNode = selection.anchor.getNode();
  const topLevelElement = anchorNode.getTopLevelElementOrThrow();
  const listNode = $isListNode(topLevelElement)
    ? topLevelElement
    : $findMatchingParent(anchorNode, $isListNode);
  const linkNode = $isLinkNode(anchorNode) ? anchorNode : $findMatchingParent(anchorNode, $isLinkNode);

  if ($isListNode(listNode)) {
    return { blockType: listNode.getListType() === "number" ? "number" : "bullet", link: $isLinkNode(linkNode) };
  }

  if ($isHeadingNode(topLevelElement)) {
    const tag = topLevelElement.getTag();

    if (tag === "h1" || tag === "h2" || tag === "h3") {
      return { blockType: tag, link: $isLinkNode(linkNode) };
    }
  }

  if ($isQuoteNode(topLevelElement)) {
    return { blockType: "quote", link: $isLinkNode(linkNode) };
  }

  if ($isCodeNode(topLevelElement)) {
    return { blockType: "code", link: $isLinkNode(linkNode) };
  }

  return { blockType: "paragraph", link: $isLinkNode(linkNode) };
}

// Tailwind class strings — the editor used to ship `nx-toolbar*`
// class hooks with no matching CSS, so the toolbar rendered as
// raw text buttons. These compile via the host app's Tailwind
// `@source` glob (see apps/web/src/app/globals.css) — the editor
// package itself doesn't ship CSS.
const TOOLBAR_BTN_BASE =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50";
const TOOLBAR_BTN_ACTIVE = "bg-accent text-foreground";

function buttonClassName(active: boolean): string {
  return active ? `${TOOLBAR_BTN_BASE} ${TOOLBAR_BTN_ACTIVE}` : TOOLBAR_BTN_BASE;
}

interface ToolbarButtonProps {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({ active = false, label, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={buttonClassName(active)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const ICON_CLASS = "h-4 w-4";
const TOOLBAR_DIVIDER = "mx-0.5 h-5 w-px bg-border/60";

export function ToolbarPlugin({ onUploadImage }: ToolbarPluginProps = {}) {
  const [editor] = useLexicalComposerContext();
  const [toolbarState, setToolbarState] = useState<ToolbarState>(DEFAULT_STATE);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);

  const insertImage = (src: string, altText: string) => {
    editor.update(() => {
      $insertNodes([$createImageNode(src, altText)]);
    });
    setImageDialogOpen(false);
  };

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
          setToolbarState(DEFAULT_STATE);
          return;
        }

        const nextState = getBlockType();

        setToolbarState({
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          underline: selection.hasFormat("underline"),
          strikethrough: selection.hasFormat("strikethrough"),
          code: selection.hasFormat("code"),
          blockType: nextState.blockType,
          link: nextState.link,
        });
      });
    });
  }, [editor]);

  return (
    <div
      className="nx-toolbar flex flex-wrap items-center gap-0.5 rounded-t-md border-b border-border/60 bg-muted/30 p-1"
      role="toolbar"
      aria-label="Rich text toolbar"
    >
      <ToolbarButton
        active={toolbarState.bold}
        label="Bold"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        <Bold className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.italic}
        label="Italic"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        <Italic className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.underline}
        label="Underline"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}
      >
        <Underline className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.strikethrough}
        label="Strikethrough"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")}
      >
        <Strikethrough className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.code}
        label="Inline code"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
      >
        <Code className={ICON_CLASS} />
      </ToolbarButton>

      <span className={TOOLBAR_DIVIDER} aria-hidden="true" />

      <ToolbarButton
        active={toolbarState.blockType === "paragraph"}
        label="Paragraph"
        onClick={() =>
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createParagraphNode());
          })
        }
      >
        <Pilcrow className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.blockType === "h1"}
        label="Heading 1"
        onClick={() =>
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createHeadingNode("h1"));
          })
        }
      >
        <Heading1 className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.blockType === "h2"}
        label="Heading 2"
        onClick={() =>
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createHeadingNode("h2"));
          })
        }
      >
        <Heading2 className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.blockType === "h3"}
        label="Heading 3"
        onClick={() =>
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createHeadingNode("h3"));
          })
        }
      >
        <Heading3 className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.blockType === "quote"}
        label="Quote"
        onClick={() =>
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createQuoteNode());
          })
        }
      >
        <Quote className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.blockType === "code"}
        label="Code block"
        onClick={() =>
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createCodeNode());
          })
        }
      >
        <Code2 className={ICON_CLASS} />
      </ToolbarButton>

      <span className={TOOLBAR_DIVIDER} aria-hidden="true" />

      <ToolbarButton
        active={toolbarState.blockType === "bullet"}
        label="Bulleted list"
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      >
        <List className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.blockType === "number"}
        label="Numbered list"
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      >
        <ListOrdered className={ICON_CLASS} />
      </ToolbarButton>

      <span className={TOOLBAR_DIVIDER} aria-hidden="true" />

      <ToolbarButton
        label="Horizontal rule"
        onClick={() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)}
      >
        <Minus className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        active={toolbarState.link}
        label="Link"
        onClick={() =>
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, toolbarState.link ? null : "https://")
        }
      >
        <LinkIcon className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton label="Insert image" onClick={() => setImageDialogOpen(true)}>
        <ImageIcon className={ICON_CLASS} />
      </ToolbarButton>

      {imageDialogOpen ? (
        <InsertImageDialog
          onUploadImage={onUploadImage}
          onCancel={() => setImageDialogOpen(false)}
          onInsert={insertImage}
        />
      ) : null}
    </div>
  );
}

interface InsertImageDialogProps {
  onUploadImage?: (file: File) => Promise<{ url: string; alt?: string }>;
  onCancel: () => void;
  onInsert: (src: string, altText: string) => void;
}

function InsertImageDialog({ onUploadImage, onCancel, onInsert }: InsertImageDialogProps) {
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (file: File) => {
    if (!onUploadImage) return;
    setUploading(true);
    setError(null);
    try {
      const result = await onUploadImage(file);
      // Pre-fill the URL field so the user can review the result
      // before clicking Insert. Some uploaders return an `alt`; use
      // it as a default if the alt input is still empty.
      setUrl(result.url);
      if (!alt && result.alt) setAlt(result.alt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Image URL is required.");
      return;
    }
    onInsert(trimmed, alt.trim());
  };

  const labelText = "block text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground";
  const inputBase =
    "h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Insert image"
      onClick={onCancel}
    >
      <form
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <h3 className="text-sm font-semibold">Insert image</h3>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        ) : null}
        {onUploadImage ? (
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Upload</span>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileChange(file);
              }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-muted/70"
            />
            {uploading ? (
              <small className="text-xs text-muted-foreground">Uploading…</small>
            ) : null}
          </label>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Image URL</span>
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            disabled={uploading}
            className={inputBase}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Alt text</span>
          <input
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Describe the image for screen readers"
            disabled={uploading}
            className={inputBase}
          />
        </label>
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-border/60 bg-background px-3 text-sm font-medium hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={onCancel}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={uploading || url.trim() === ""}
          >
            Insert
          </button>
        </div>
      </form>
    </div>
  );
}
