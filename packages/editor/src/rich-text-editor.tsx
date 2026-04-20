import { useMemo } from "react";

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
  const serializedValue = value ? JSON.stringify(value) : undefined;
  const composerKey = serializedValue ?? "nx-editor-empty";
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "nexpress-editor",
      nodes: NODES,
      editable: !config?.readOnly,
      onError(error) {
        throw error;
      },
    }),
    [config],
  );

  return (
    <LexicalComposer key={composerKey} initialConfig={{ ...initialConfig, editorState: serializedValue }}>
      <div className="nx-rich-text-editor">
        <ToolbarPlugin />
        <RichTextPlugin
          contentEditable={<ContentEditable className="nx-editor-content" />}
          placeholder={<div className="nx-editor-placeholder">{config?.placeholder ?? "Start writing..."}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <HorizontalRulePlugin />
        <NxEditorOnChangePlugin onChange={onChange} />
      </div>
    </LexicalComposer>
  );
}
