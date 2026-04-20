import type { JSX } from "react";

import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";

type DomElement = HTMLElement & { className: string };

declare const document: {
  createElement(tagName: string): DomElement;
};

interface SerializedImageNode extends SerializedLexicalNode {
  type: "image";
  version: 1;
  src: string;
  altText: string;
  width?: number;
  height?: number;
}

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __altText: string;
  __width?: number;
  __height?: number;

  static override getType(): "image" {
    return "image";
  }

  static override clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__width, node.__height, node.__key);
  }

  static override importJSON(serializedNode: SerializedImageNode): ImageNode {
    return new ImageNode(
      serializedNode.src,
      serializedNode.altText,
      serializedNode.width,
      serializedNode.height,
    );
  }

  constructor(src: string, altText: string, width?: number, height?: number, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__width = width;
    this.__height = height;
  }

  override exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: "image",
      version: 1,
      src: this.__src,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
    };
  }

  override createDOM(_config: EditorConfig): DomElement {
    const element = document.createElement("span");
    element.className = "nx-editor-image";
    return element;
  }

  override updateDOM(_prevNode: ImageNode, _dom: HTMLElement, _config: EditorConfig): false {
    return false;
  }

  override isInline(): false {
    return false;
  }

  override decorate(): JSX.Element {
    return (
      <img
        src={this.__src}
        alt={this.__altText}
        width={this.__width}
        height={this.__height}
      />
    );
  }
}

export function $createImageNode(src: string, altText: string): ImageNode {
  return $applyNodeReplacement(new ImageNode(src, altText));
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
