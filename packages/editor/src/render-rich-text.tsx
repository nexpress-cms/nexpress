import React from "react";

import type { NxRichTextContent } from "./types.js";

const IS_BOLD = 1;
const IS_ITALIC = 2;
const IS_STRIKETHROUGH = 4;
const IS_UNDERLINE = 8;
const IS_CODE = 16;
const IS_SUBSCRIPT = 32;
const IS_SUPERSCRIPT = 64;

type RichTextNode = {
  type?: string;
  children?: RichTextNode[];
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  url?: string;
  src?: string;
  altText?: string;
  direction?: "ltr" | "rtl" | null;
};

function isRichTextNode(value: unknown): value is RichTextNode {
  return typeof value === "object" && value !== null;
}

function toArray(value: unknown): RichTextNode[] {
  return Array.isArray(value) ? value.filter(isRichTextNode) : [];
}

function toFormatMask(value: number | string | undefined): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function sanitizeUrl(url: unknown): string | undefined {
  if (typeof url !== "string") {
    return undefined;
  }

  const value = url.trim();

  if (value.length === 0) {
    return undefined;
  }

  if (value.startsWith("/") || value.startsWith("#") || value.startsWith("?")) {
    return value;
  }

  const protocolMatch = value.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/);

  if (!protocolMatch) {
    return value;
  }

  const protocol = protocolMatch[1]?.toLowerCase();

  if (protocol === "http" || protocol === "https" || protocol === "mailto" || protocol === "tel") {
    return value;
  }

  return undefined;
}

function extractText(node: RichTextNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }

  if (node.type === "linebreak") {
    return "\n";
  }

  return toArray(node.children).map(extractText).join("");
}

function applyTextFormats(text: string, format: number, key: string): React.ReactNode {
  let value: React.ReactNode = text;

  if ((format & IS_CODE) !== 0) {
    value = React.createElement("code", { key: `${key}:code` }, value);
  }

  if ((format & IS_UNDERLINE) !== 0) {
    value = React.createElement(
      "span",
      { key: `${key}:underline`, style: { textDecoration: "underline" } },
      value,
    );
  }

  if ((format & IS_STRIKETHROUGH) !== 0) {
    value = React.createElement("s", { key: `${key}:strikethrough` }, value);
  }

  if ((format & IS_ITALIC) !== 0) {
    value = React.createElement("em", { key: `${key}:italic` }, value);
  }

  if ((format & IS_BOLD) !== 0) {
    value = React.createElement("strong", { key: `${key}:bold` }, value);
  }

  if ((format & IS_SUBSCRIPT) !== 0) {
    value = React.createElement("sub", { key: `${key}:subscript` }, value);
  }

  if ((format & IS_SUPERSCRIPT) !== 0) {
    value = React.createElement("sup", { key: `${key}:superscript` }, value);
  }

  return value;
}

function renderChildren(nodes: RichTextNode[], keyPrefix: string): React.ReactNode[] {
  return nodes
    .map((node, index) => renderNode(node, `${keyPrefix}:${index}`))
    .filter((node): node is React.ReactNode => node !== null);
}

function renderNode(node: RichTextNode, key: string): React.ReactNode | null {
  switch (node.type) {
    case "text":
      return applyTextFormats(node.text ?? "", toFormatMask(node.format), key);
    case "paragraph":
      return React.createElement("p", { key, dir: node.direction ?? undefined }, renderChildren(toArray(node.children), key));
    case "heading": {
      const tag = typeof node.tag === "string" && /^h[1-6]$/.test(node.tag) ? node.tag : "h1";
      return React.createElement(tag, { key, dir: node.direction ?? undefined }, renderChildren(toArray(node.children), key));
    }
    case "quote":
      return React.createElement("blockquote", { key, dir: node.direction ?? undefined }, renderChildren(toArray(node.children), key));
    case "list": {
      const tag = node.listType === "number" ? "ol" : "ul";
      return React.createElement(tag, { key, dir: node.direction ?? undefined }, renderChildren(toArray(node.children), key));
    }
    case "listitem":
      return React.createElement("li", { key, dir: node.direction ?? undefined }, renderChildren(toArray(node.children), key));
    case "link":
      return React.createElement(
        "a",
        { key, href: sanitizeUrl(node.url) },
        renderChildren(toArray(node.children), key),
      );
    case "image":
      return React.createElement("img", {
        key,
        src: typeof node.src === "string" ? node.src : "",
        alt: typeof node.altText === "string" ? node.altText : "",
      });
    case "code":
      return React.createElement(
        "pre",
        { key, dir: node.direction ?? undefined },
        React.createElement("code", null, extractText(node)),
      );
    case "horizontalrule":
      return React.createElement("hr", { key });
    case "linebreak":
      return React.createElement("br", { key });
    default: {
      const children = toArray(node.children);
      if (children.length === 0) {
        return null;
      }

      return React.createElement(React.Fragment, { key }, renderChildren(children, key));
    }
  }
}

export function renderRichText(content: NxRichTextContent): React.ReactElement | null;
export function renderRichText(content: NxRichTextContent | null | undefined): React.ReactElement | null {
  if (!content) {
    return null;
  }

  return React.createElement(React.Fragment, null, renderChildren(toArray(content.root.children), "root"));
}
