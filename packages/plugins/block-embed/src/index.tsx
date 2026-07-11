import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/**
 * Pulls a YouTube video id out of any of the URL shapes YouTube serves:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/embed/VIDEO_ID
 *   - https://www.youtube.com/shorts/VIDEO_ID
 *
 * Returns null when the URL is missing / malformed / not YouTube so the
 * render function can surface a clear placeholder instead of an iframe to
 * "about:blank".
 */
function parseYouTubeId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return id && id.length > 0 ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") {
      return url.searchParams.get("v");
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "embed" || segments[0] === "shorts") {
      return segments[1] ?? null;
    }
  }
  return null;
}

const youtubeBlock: NpBlockDefinition = {
  type: "embed.youtube",
  label: "YouTube",
  description: "Embeds a YouTube video by URL.",
  icon: "▶",
  defaultProps: {
    url: "",
    aspectRatio: "16:9",
    title: "YouTube video",
  },
  propsSchema: [
    {
      name: "url",
      label: "YouTube URL",
      type: "url",
      required: true,
      defaultValue: "",
    },
    {
      name: "aspectRatio",
      label: "Aspect ratio",
      type: "select",
      defaultValue: "16:9",
      options: [
        { label: "16:9 (widescreen)", value: "16:9" },
        { label: "4:3 (standard)", value: "4:3" },
        { label: "1:1 (square)", value: "1:1" },
        { label: "9:16 (vertical)", value: "9:16" },
      ],
    },
    {
      name: "title",
      label: "Accessible title",
      type: "text",
      translatable: true,
      defaultValue: "YouTube video",
    },
  ],
  render: (props) => {
    const url = readString(props.url, "");
    const aspectRatio = readString(props.aspectRatio, "16:9");
    const title = readString(props.title, "YouTube video");
    const videoId = parseYouTubeId(url);

    const wrapperStyle: CSSProperties = {
      position: "relative",
      width: "100%",
      aspectRatio: aspectRatio.replace(":", " / "),
      margin: "1.5rem 0",
      borderRadius: "0.75rem",
      overflow: "hidden",
      backgroundColor: "#0f172a",
    };

    if (!videoId) {
      const placeholderStyle: CSSProperties = {
        ...wrapperStyle,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#cbd5e1",
        fontSize: "0.875rem",
        textAlign: "center",
        padding: "1rem",
      };
      return (
        <div className="np-block-embed np-block-embed--invalid" style={placeholderStyle}>
          <span>
            {url.length > 0
              ? `Couldn't recognize "${url}" as a YouTube URL.`
              : "Add a YouTube URL to embed a video."}
          </span>
        </div>
      );
    }

    const src = `https://www.youtube-nocookie.com/embed/${videoId}`;
    const iframeStyle: CSSProperties = {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      border: "none",
    };

    return (
      <div className="np-block-embed np-block-embed--youtube" style={wrapperStyle}>
        <iframe
          src={src}
          title={title}
          style={iframeStyle}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  },
};

export const embedPlugin = definePlugin({
  manifest: {
    id: "block-embed",
    version: "0.1.0",
    name: "Embed blocks",
    description: "Adds embed blocks (YouTube, more coming) to the page builder.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  blocks: [youtubeBlock] satisfies NpBlockDefinition[],
});

export default embedPlugin;
