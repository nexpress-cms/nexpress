import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/**
 * Single-image block. Stores either a `mediaId` (resolved by
 * the host's media adapter at render time) or a direct `src`
 * URL. The runtime renderer prefers `mediaId` when both are
 * set; an alt-text and optional caption are surfaced
 * underneath.
 */
export const imageBlock: NpBlockDefinition = {
  type: "image",
  label: "Image",
  description: "Single image with caption and alt text.",
  icon: "Image",
  iconKind: "lucide",
  docBodyKind: "image",
  category: "Media",
  source: "built-in",
  keywords: ["image", "photo", "picture", "media"],
  summaryFields: ["alt", "src"],
  defaultProps: {
    mediaId: "",
    src: "",
    alt: "",
    caption: "",
  },
  propsSchema: [
    {
      name: "mediaId",
      label: "From media library",
      type: "media",
      accept: ["image/"],
      defaultValue: "",
    },
    {
      name: "src",
      label: "Image URL",
      type: "url",
      defaultValue: "",
    },
    {
      name: "alt",
      label: "Alt text",
      type: "text",
      required: true,
      defaultValue: "",
    },
    {
      name: "caption",
      label: "Caption",
      type: "text",
      defaultValue: "",
    },
  ],
  render: (props) => {
    const src = readString(props.src, "");
    const alt = readString(props.alt, "");
    const caption = readString(props.caption, "");
    if (!src) return <figure className="np-image np-image-empty" aria-hidden="true" />;
    return (
      <figure className="np-image">
        <img src={src} alt={alt} loading="lazy" />
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
    );
  },
};
