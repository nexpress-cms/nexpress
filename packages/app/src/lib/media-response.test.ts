import { describe, expect, it } from "vitest";

import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import type { NpMediaRecord } from "@nexpress/core/media-contract";
import { setStorageAdapter } from "@nexpress/core/bootstrap";
import { type NpStorageAdapter } from "@nexpress/core/storage";

import { toMediaApiItem } from "./media-response";

const adapter: NpStorageAdapter = {
  kind: "capture",
  upload: () => Promise.resolve(),
  getStream: () => Promise.reject(new Error("not used")),
  getUrl: (key) => Promise.resolve(`/assets/${key}`),
  delete: () => Promise.resolve(),
  exists: () => Promise.resolve(true),
};

function mediaRecord(): NpMediaRecord {
  return {
    id: "bd134b0f-b9ea-4ff4-81ef-606e42e27703",
    siteId: "default",
    filename: "photo.jpg",
    originalFilename: "photo.jpg",
    mimeType: "image/jpeg",
    filesize: 5000,
    width: 1200,
    height: 800,
    alt: "Photo",
    caption: npCreateEmptyRichTextContent(),
    focalPoint: null,
    sizes: {
      thumbnail: {
        filename: "thumbnail.avif",
        mimeType: "image/avif",
        filesize: 800,
        width: 300,
        height: 200,
        storageKey: "media/id/thumbnail.avif",
      },
    },
    storageKey: "media/id/original.jpg",
    hash: "a".repeat(64),
    status: "ready",
    folderId: null,
    uploadedBy: null,
    uploadedByMemberId: null,
    createdAt: new Date("2026-07-12T00:00:00.000Z"),
    updatedAt: new Date("2026-07-12T00:01:00.000Z"),
    deletedAt: null,
  };
}

describe("media API response", () => {
  it("resolves original and actual variant storage keys without guessing formats", async () => {
    setStorageAdapter(adapter);
    const item = await toMediaApiItem(mediaRecord(), null);

    expect(item.urls).toEqual({
      original: "/assets/media/id/original.jpg",
      thumbnail: "/assets/media/id/thumbnail.avif",
    });
    expect(item.filesize).toBe(5000);
    expect(item.createdAt).toBe("2026-07-12T00:00:00.000Z");
    expect(item.uploader).toBeNull();
  });
});
