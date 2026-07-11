import { describe, expect, it } from "vitest";

import {
  $getRoot,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_LOW,
  createEditor,
  HISTORY_MERGE_TAG,
  type SerializedParagraphNode,
  type SerializedTextNode,
} from "lexical";

import { serializeEditorValue, synchronizeEditorValue } from "./editor-state-bridge-plugin.js";
import type { NpRichTextContent } from "./types.js";

function richTextContent(text: string): NpRichTextContent {
  const textNode: SerializedTextNode = {
    detail: 0,
    format: 0,
    mode: "normal",
    style: "",
    text,
    type: "text",
    version: 1,
  };
  const paragraph: SerializedParagraphNode = {
    children: [textNode],
    direction: null,
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
    type: "paragraph",
    version: 1,
  };

  return {
    version: 1,
    document: {
      root: {
        children: [paragraph],
        direction: null,
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    },
  };
}

function createTestEditor(initialValue: NpRichTextContent) {
  const editor = createEditor({
    namespace: "nexpress-editor-value-sync-test",
    onError(error) {
      throw error;
    },
  });
  const initialValueKey = serializeEditorValue(initialValue);

  if (initialValueKey === null) {
    throw new Error("Test rich-text fixtures must serialize to a value.");
  }

  editor.setEditorState(editor.parseEditorState(initialValueKey));
  return { editor, initialValueKey };
}

function editorText(editor: ReturnType<typeof createEditor>): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent());
}

describe("synchronizeEditorValue", () => {
  it("leaves editor-originated values and history untouched", () => {
    const { editor, initialValueKey } = createTestEditor(richTextContent("Current body"));
    const currentValueKey = { current: initialValueKey };
    let historyClears = 0;
    const unregister = editor.registerCommand(
      CLEAR_HISTORY_COMMAND,
      () => {
        historyClears += 1;
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    expect(synchronizeEditorValue(editor, initialValueKey, currentValueKey)).toBe(false);
    expect(editorText(editor)).toBe("Current body");
    expect(historyClears).toBe(0);

    unregister();
  });

  it("applies an external value with a history-merge tag and clears stale undo state", () => {
    const { editor, initialValueKey } = createTestEditor(richTextContent("Original body"));
    const recoveredValueKey = serializeEditorValue(richTextContent("Recovered body"));
    const currentValueKey = { current: initialValueKey };
    const observedTags: Set<string>[] = [];
    let historyClears = 0;
    const unregisterUpdate = editor.registerUpdateListener(({ tags }) => {
      observedTags.push(new Set(tags));
    });
    const unregisterHistory = editor.registerCommand(
      CLEAR_HISTORY_COMMAND,
      () => {
        historyClears += 1;
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    expect(recoveredValueKey).not.toBeNull();
    expect(synchronizeEditorValue(editor, recoveredValueKey, currentValueKey)).toBe(true);
    expect(editorText(editor)).toBe("Recovered body");
    expect(currentValueKey.current).toBe(recoveredValueKey);
    expect(observedTags.some((tags) => tags.has(HISTORY_MERGE_TAG))).toBe(true);
    expect(historyClears).toBe(1);

    unregisterHistory();
    unregisterUpdate();
  });

  it("turns an external null value into one valid empty paragraph", () => {
    const { editor, initialValueKey } = createTestEditor(richTextContent("Remove me"));
    const currentValueKey = { current: initialValueKey };

    expect(synchronizeEditorValue(editor, null, currentValueKey)).toBe(true);
    expect(editorText(editor)).toBe("");
    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildrenSize()).toBe(1);
      expect(root.getFirstChild()?.getType()).toBe("paragraph");
    });
    expect(currentValueKey.current).toBeNull();
  });

  it("keeps the current value key and content when an external payload is malformed", () => {
    const { editor, initialValueKey } = createTestEditor(richTextContent("Safe body"));
    const currentValueKey = { current: initialValueKey };

    expect(() => synchronizeEditorValue(editor, "{malformed", currentValueKey)).toThrow();
    expect(editorText(editor)).toBe("Safe body");
    expect(currentValueKey.current).toBe(initialValueKey);
  });

  it("rejects raw Lexical JSON at the editor boundary", () => {
    const rawLexical = {
      root: {
        type: "root",
        children: [],
      },
    };

    expect(() => serializeEditorValue(rawLexical)).toThrow(
      'exactly "version" and "document"',
    );
  });
});
