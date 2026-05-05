import { useRef } from "react";

import { OnChangePlugin as LexicalOnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { $getRoot } from "lexical";

import type { NpRichTextContent } from "./types.js";

interface NpEditorOnChangePluginProps {
  onChange: (value: NpRichTextContent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRichTextContent(value: unknown): value is NpRichTextContent {
  if (!isRecord(value)) {
    return false;
  }

  const root = value.root;

  if (!isRecord(root)) {
    return false;
  }

  return root.type === "root" && Array.isArray(root.children);
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

        const serialized = editorState.toJSON();

        if (!isRichTextContent(serialized)) {
          return;
        }

        onChange(serialized);
      }}
    />
  );
}
