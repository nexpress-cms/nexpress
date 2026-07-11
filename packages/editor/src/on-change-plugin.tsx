import { useRef } from "react";

import { OnChangePlugin as LexicalOnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { $getRoot } from "lexical";
import { NP_RICH_TEXT_CONTENT_VERSION, npValidateRichTextContent } from "@nexpress/core/fields";

import type { NpRichTextContent } from "./types.js";

interface NpEditorOnChangePluginProps {
  onChange: (value: NpRichTextContent) => void;
}

export function createRichTextContent(document: unknown): NpRichTextContent {
  // Lexical's in-memory JSON can include enumerable `undefined` properties
  // that disappear on the wire. Normalize through JSON before applying the
  // exact NexPress content contract so editor changes and API payloads share
  // the same representation.
  const serialized: unknown = JSON.parse(
    JSON.stringify({
      version: NP_RICH_TEXT_CONTENT_VERSION,
      document,
    }),
  );
  const result = npValidateRichTextContent(serialized);
  if (!result.ok) {
    throw new Error(`Lexical emitted invalid NexPress rich-text content: ${result.message}`);
  }
  return result.value;
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

        onChange(createRichTextContent(editorState.toJSON()));
      }}
    />
  );
}
