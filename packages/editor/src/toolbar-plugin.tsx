import { useEffect, useState } from "react";

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

function buttonClassName(active: boolean): string {
  return active ? "nx-toolbar-btn nx-toolbar-btn-active" : "nx-toolbar-btn";
}

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
    <div className="nx-toolbar" role="toolbar" aria-label="Rich text toolbar">
      <button
        type="button"
        className={buttonClassName(toolbarState.bold)}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        Bold
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.italic)}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        Italic
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.underline)}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}
      >
        Underline
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.strikethrough)}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")}
      >
        Strike
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.code)}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
      >
        Code
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.blockType === "paragraph")}
        onClick={() => {
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createParagraphNode());
          });
        }}
      >
        Paragraph
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.blockType === "h1")}
        onClick={() => {
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createHeadingNode("h1"));
          });
        }}
      >
        H1
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.blockType === "h2")}
        onClick={() => {
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createHeadingNode("h2"));
          });
        }}
      >
        H2
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.blockType === "h3")}
        onClick={() => {
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createHeadingNode("h3"));
          });
        }}
      >
        H3
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.blockType === "quote")}
        onClick={() => {
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createQuoteNode());
          });
        }}
      >
        Quote
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.blockType === "code")}
        onClick={() => {
          editor.update(() => {
            $setBlocksType($getSelection(), () => $createCodeNode());
          });
        }}
      >
        Code block
      </button>
      <button
        type="button"
        className="nx-toolbar-btn"
        onClick={() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)}
      >
        Rule
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.blockType === "bullet")}
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      >
        Bullets
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.blockType === "number")}
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      >
        Numbers
      </button>
      <button
        type="button"
        className={buttonClassName(toolbarState.link)}
        onClick={() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, toolbarState.link ? null : "https://")}
      >
        Link
      </button>
      <button
        type="button"
        className="nx-toolbar-btn"
        onClick={() => setImageDialogOpen(true)}
      >
        Image
      </button>
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

  return (
    <div
      className="nx-toolbar-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Insert image"
      onClick={onCancel}
    >
      <form
        className="nx-toolbar-dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <h3>Insert image</h3>
        {error ? (
          <div role="alert" className="nx-form-error">
            {error}
          </div>
        ) : null}
        {onUploadImage ? (
          <label className="nx-form-field">
            <span className="nx-form-label">Upload</span>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileChange(file);
              }}
            />
            {uploading ? <small className="nx-form-help">Uploading…</small> : null}
          </label>
        ) : null}
        <label className="nx-form-field">
          <span className="nx-form-label">Image URL</span>
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            disabled={uploading}
            className="nx-form-input"
          />
        </label>
        <label className="nx-form-field">
          <span className="nx-form-label">Alt text</span>
          <input
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Describe the image for screen readers"
            disabled={uploading}
            className="nx-form-input"
          />
        </label>
        <div className="nx-form-actions">
          <button type="button" className="nx-toolbar-btn" onClick={onCancel} disabled={uploading}>
            Cancel
          </button>
          <button
            type="submit"
            className="nx-button-primary"
            disabled={uploading || url.trim() === ""}
          >
            Insert
          </button>
        </div>
      </form>
    </div>
  );
}
