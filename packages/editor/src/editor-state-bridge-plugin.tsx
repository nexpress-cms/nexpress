import { useCallback, useLayoutEffect, useRef } from "react";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getRoot,
  CLEAR_HISTORY_COMMAND,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
} from "lexical";

import { NpEditorOnChangePlugin } from "./on-change-plugin.js";
import type { NpRichTextContent } from "./types.js";

interface EditorValueKeyRef {
  current: string | null;
}

interface NpEditorStateBridgePluginProps {
  value: NpRichTextContent | null;
  onChange: (value: NpRichTextContent) => void;
}

export function serializeEditorValue(value: NpRichTextContent | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

/**
 * Replace Lexical's state only when the parent supplied a value that did not
 * originate from the editor's latest onChange. External replacements are
 * authoritative (form reset, autosave recovery, revision restore), so stale
 * undo entries are cleared after the new state lands.
 */
export function synchronizeEditorValue(
  editor: LexicalEditor,
  nextValueKey: string | null,
  currentValueKey: EditorValueKeyRef,
): boolean {
  if (nextValueKey === currentValueKey.current) {
    return false;
  }

  if (nextValueKey === null) {
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      },
      { discrete: true, tag: HISTORY_MERGE_TAG },
    );
  } else {
    const nextEditorState = editor.parseEditorState(nextValueKey);
    editor.setEditorState(nextEditorState, { tag: HISTORY_MERGE_TAG });
  }

  currentValueKey.current = nextValueKey;
  editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  return true;
}

export function NpEditorStateBridgePlugin({ value, onChange }: NpEditorStateBridgePluginProps) {
  const [editor] = useLexicalComposerContext();
  const valueKey = serializeEditorValue(value);
  const currentValueKey = useRef<string | null>(valueKey);

  useLayoutEffect(() => {
    synchronizeEditorValue(editor, valueKey, currentValueKey);
  }, [editor, valueKey]);

  const handleChange = useCallback(
    (nextValue: NpRichTextContent) => {
      currentValueKey.current = serializeEditorValue(nextValue);
      onChange(nextValue);
    },
    [onChange],
  );

  return <NpEditorOnChangePlugin onChange={handleChange} />;
}
