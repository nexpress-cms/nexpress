import { useRef } from "react";

import { OnChangePlugin as LexicalOnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { $getRoot } from "lexical";
import { NP_RICH_TEXT_CONTENT_VERSION, isNpRichTextContent } from "@nexpress/core/fields";

import type { NpRichTextContent } from "./types.js";

interface NpEditorOnChangePluginProps {
  onChange: (value: NpRichTextContent) => void;
}

function isInitialEditorState(): boolean {
  const root = $getRoot();
  const children = root.getChildren();

  if (children.length === 0) {
    return true;
  }

  if (children.length !== 1) {
    return false;
  }

  const firstChild = children[0];

  return firstChild?.getType() === "paragraph" && firstChild.getTextContent().trim().length === 0;
}

export function NpEditorOnChangePlugin({ onChange }: NpEditorOnChangePluginProps) {
  const hasObservedInitialState = useRef(false);

  return (
    <LexicalOnChangePlugin
      ignoreSelectionChange={true}
      onChange={(editorState) => {
        let shouldSkip = false;

        editorState.read(() => {
          if (!hasObservedInitialState.current && isInitialEditorState()) {
            shouldSkip = true;
          }
        });

        if (!hasObservedInitialState.current) {
          hasObservedInitialState.current = true;
        }

        if (shouldSkip) {
          return;
        }

        const serialized: unknown = {
          version: NP_RICH_TEXT_CONTENT_VERSION,
          document: editorState.toJSON(),
        };

        if (!isNpRichTextContent(serialized)) {
          throw new Error("Lexical emitted invalid NexPress rich-text content");
        }

        onChange(serialized);
      }}
    />
  );
}
