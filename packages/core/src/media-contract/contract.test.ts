import { describe, expect, it } from "vitest";

import { npCreateEmptyRichTextContent } from "../fields/rich-text.js";
import {
  isNpMediaApiItem,
  isNpMediaFocalPoint,
  isNpMediaProcessingOptions,
  isNpMediaRecord,
  isNpMediaVariants,
  isNpMediaWireRecord,
  npAnalyzeMediaProcessingOptions,
  npAnalyzeMediaRecord,
  npAnalyzeMediaVariants,
  npMediaContractLimits,
  npSerializeMediaRecord,
} from "./contract.js";
import type { NpMediaRecord, NpMediaVariants } from "./types.js";

const variants: NpMediaVariants = {
  thumbnail: {
    filename: "thumbnail.webp",
    mimeType: "image/webp",
    filesize: 1234,
    width: 300,
    height: 200,
    storageKey: "media/123/thumbnail.webp",
  },
};

function validRecord(): NpMediaRecord {
  return {
    id: "bd134b0f-b9ea-4ff4-81ef-606e42e27703",
    siteId: "default",
    filename: "photo.jpg",
    originalFilename: "photo.jpg",
    mimeType: "image/jpeg",
    filesize: 12_345,
    width: 1200,
    height: 800,
    alt: "A photo",
    caption: npCreateEmptyRichTextContent(),
    focalPoint: { x: 0.5, y: 0.25 },
    sizes: variants,
    storageKey: "media/bd134b0f-b9ea-4ff4-81ef-606e42e27703/original.jpg",
    hash: "a".repeat(64),
    status: "ready",
    folderId: null,
    uploadedBy: "c7f9f317-ec3a-4a81-99f7-2077018c33ee",
    uploadedByMemberId: null,
    createdAt: new Date("2026-07-12T00:00:00.000Z"),
    updatedAt: new Date("2026-07-12T00:01:00.000Z"),
    deletedAt: null,
  };
}

describe("media runtime contract", () => {
  it("accepts exact variant metadata and rejects cached URLs or unsafe keys", () => {
    expect(isNpMediaVariants(variants)).toBe(true);
    expect(
      npAnalyzeMediaVariants({
        thumbnail: { ...variants.thumbnail, url: "https://stale.example/thumbnail.webp" },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "unknown-field",
        path: "media.sizes.thumbnail.url",
      }),
    );
    expect(
      npAnalyzeMediaVariants({
        "../escape": variants.thumbnail,
        original: variants.thumbnail,
        spaced: { ...variants.thumbnail, storageKey: "media/id/bad key.webp" },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "media.sizes.../escape" }),
        expect.objectContaining({ path: "media.sizes.original" }),
        expect.objectContaining({ path: "media.sizes.spaced.storageKey" }),
      ]),
    );
  });

  it("bounds focal points and accepts only finite normalized coordinates", () => {
    expect(isNpMediaFocalPoint({ x: 0, y: 1 })).toBe(true);
    expect(isNpMediaFocalPoint({ x: -0.1, y: 0.5 })).toBe(false);
    expect(isNpMediaFocalPoint({ x: Number.NaN, y: 0.5 })).toBe(false);
    expect(isNpMediaFocalPoint({ x: 0.5, y: 0.5, z: 0 })).toBe(false);
  });

  it("validates exact processing options before Sharp or storage work", () => {
    const options = {
      sizes: [
        { name: "thumbnail", width: 300 },
        { name: "og", width: 1200, height: 630, crop: "center" as const },
      ],
      format: "avif" as const,
      quality: 75,
    };
    expect(isNpMediaProcessingOptions(options)).toBe(true);
    expect(
      npAnalyzeMediaProcessingOptions({
        sizes: [
          { name: "duplicate", width: 300 },
          { name: "duplicate", width: 600 },
          { name: "original", width: 20.5, crop: "center" },
        ],
        format: "gif",
        quality: 0,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-variant" }),
        expect.objectContaining({ path: "media.processing.sizes.2.name" }),
        expect.objectContaining({ path: "media.processing.sizes.2.width" }),
        expect.objectContaining({ code: "invariant", path: "media.processing.sizes.2.crop" }),
        expect.objectContaining({ path: "media.processing.format" }),
        expect.objectContaining({ path: "media.processing.quality" }),
      ]),
    );
    expect(
      isNpMediaProcessingOptions({
        sizes: Array.from({ length: npMediaContractLimits.maxVariants + 1 }, (_, index) => ({
          name: `v${index.toString()}`,
          width: 100,
        })),
      }),
    ).toBe(false);
  });

  it("validates complete persisted records and cross-field invariants", () => {
    const record = validRecord();
    expect(isNpMediaRecord(record)).toBe(true);
    expect(
      npAnalyzeMediaRecord({
        ...record,
        height: null,
        uploadedByMemberId: "35fd48fa-4c71-438f-9201-a2d3f77841d7",
        extra: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field", path: "media.record.extra" }),
        expect.objectContaining({ code: "invariant", path: "media.record.width" }),
        expect.objectContaining({ code: "invariant", path: "media.record.uploadedBy" }),
      ]),
    );
    expect(isNpMediaRecord({ ...record, caption: { root: {} } })).toBe(false);
    expect(isNpMediaRecord({ ...record, siteId: "Wrong Site" })).toBe(false);
  });

  it("serializes dates into the exact Admin/API item contract", () => {
    const wire = npSerializeMediaRecord(validRecord());
    expect(isNpMediaWireRecord(wire)).toBe(true);
    expect(wire.createdAt).toBe("2026-07-12T00:00:00.000Z");
    expect(
      isNpMediaApiItem({
        ...wire,
        urls: { original: "/uploads/original.jpg", thumbnail: "/uploads/thumbnail.webp" },
        uploader: { kind: "staff", name: "Admin", email: "admin@example.com" },
      }),
    ).toBe(true);
    expect(
      isNpMediaApiItem({
        ...wire,
        urls: { original: "", thumbnail: null },
      }),
    ).toBe(false);
  });
});
