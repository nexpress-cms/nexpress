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
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
} from "lexical";

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

export function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [toolbarState, setToolbarState] = useState<ToolbarState>(DEFAULT_STATE);

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
    </div>
  );
}
