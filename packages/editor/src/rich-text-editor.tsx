import { useMemo, useState } from "react";

import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";

import { ImageNode } from "./image-node.js";
import { NxEditorOnChangePlugin } from "./on-change-plugin.js";
import { ToolbarPlugin } from "./toolbar-plugin.js";
import type { NxEditorConfig, NxRichTextContent } from "./types.js";

interface NxRichTextEditorProps {
  value: NxRichTextContent | null;
  onChange: (value: NxRichTextContent) => void;
  config?: NxEditorConfig;
}

const NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  CodeHighlightNode,
  HorizontalRuleNode,
  ImageNode,
];

export function NxRichTextEditor({ value, onChange, config }: NxRichTextEditorProps) {
  // Capture the value at first mount only. After that, Lexical's
  // internal editor state IS the source of truth — typing flows
  // out via NxEditorOnChangePlugin → form → `value` prop, but we
  // deliberately do NOT feed `value` back into the composer on
  // every render. The previous implementation re-keyed the
  // <LexicalComposer> on the serialized value, which destroyed
  // and recreated the entire editor (including the contenteditable
  // node) per keystroke — losing focus, undo history, and
  // selection. (#XXX)
  //
  // Trade-off: this means external value resets (e.g. the form's
  // reset() being called programmatically) won't propagate into
  // the editor. Not a v1 use case in this codebase; if it lands,
  // wire a separate sync effect that calls
  // `editor.setEditorState(editor.parseEditorState(json))` on
  // identity changes that aren't from our own onChange.
  const [initialEditorState] = useState(() => (value ? JSON.stringify(value) : undefined));
  const [initialReadOnly] = useState(() => Boolean(config?.readOnly));

  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "nexpress-editor",
      nodes: NODES,
      editable: !initialReadOnly,
      editorState: initialEditorState,
      onError(error: Error) {
        // Surface the failure first — without this hook a Lexical
        // crash unmounts the editor mid-edit and the operator
        // never hears about the underlying error (#344). The
        // browser console is the only target we can reach from a
        // client bundle without a logger dep; production sites
        // can pipe `window.onerror` into their tracker. Re-throw
        // so React's error boundary still applies.
        console.error("[nx-editor] Lexical error:", error);
        throw error;
      },
    }),
    // initialEditorState + initialReadOnly are captured once via
    // useState and never change identity — `[]` would be equally
    // correct but lists them so the rule-of-hooks linter stays
    // happy and the dependencies are explicit at the call site.
    [initialEditorState, initialReadOnly],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="nx-rich-text-editor overflow-hidden rounded-md border border-border/60 bg-background focus-within:ring-2 focus-within:ring-primary/30">
        <ToolbarPlugin onUploadImage={config?.onUploadImage} />
        {/* `relative` wraps the contentEditable so the placeholder
            (positioned absolutely by Lexical's RichTextPlugin) sits
            on top of the empty input area without overlapping the
            toolbar. */}
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="nx-editor-content min-h-[200px] px-4 py-3 text-sm leading-relaxed outline-none [&_p]:my-2 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:font-semibold [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_ul]:my-2 [&_ul]:ml-6 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:ml-6 [&_ol]:list-decimal [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_hr]:my-4 [&_hr]:border-border/60" />
            }
            placeholder={
              <div className="nx-editor-placeholder pointer-events-none absolute top-3 left-4 select-none text-sm text-muted-foreground">
                {config?.placeholder ?? "Start writing..."}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <HorizontalRulePlugin />
        <NxEditorOnChangePlugin onChange={onChange} />
      </div>
    </LexicalComposer>
  );
}
