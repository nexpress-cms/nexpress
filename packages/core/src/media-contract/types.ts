import type { NpRichTextContent } from "../fields/rich-text.js";

export const npMediaStatuses = ["processing", "ready", "error"] as const;
export type NpMediaStatus = (typeof npMediaStatuses)[number];

export const npMediaImageFormats = ["avif", "jpeg", "png", "webp"] as const;
export type NpMediaImageFormat = (typeof npMediaImageFormats)[number];

export const npMediaCropPositions = ["center", "top", "bottom", "left", "right"] as const;
export type NpMediaCropPosition = (typeof npMediaCropPositions)[number];

export interface NpMediaFocalPoint {
  x: number;
  y: number;
}

/** Exact JSON value stored under one key in `np_media.sizes`. */
export interface NpMediaVariant {
  filename: string;
  mimeType: string;
  filesize: number;
  width: number;
  height: number;
  storageKey: string;
}

/** Exact JSON object stored in `np_media.sizes`. */
export type NpMediaVariants = Record<string, NpMediaVariant>;

export interface NpMediaImageSize {
  name: string;
  width: number;
  height?: number;
  crop?: NpMediaCropPosition;
}

export interface NpMediaProcessingOptions {
  sizes?: NpMediaImageSize[];
  format?: NpMediaImageFormat;
  quality?: number;
}

/** Server-side media row after canonical persisted-value validation. */
export interface NpMediaRecord {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  filesize: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  caption: NpRichTextContent | null;
  focalPoint: NpMediaFocalPoint | null;
  sizes: NpMediaVariants | null;
  storageKey: string;
  hash: string;
  status: NpMediaStatus;
  folderId: string | null;
  uploadedBy: string | null;
  uploadedByMemberId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type NpMediaWireRecord = Omit<NpMediaRecord, "createdAt" | "updatedAt" | "deletedAt"> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type NpMediaUploaderSummary =
  | { kind: "staff"; name: string | null; email: string | null }
  | { kind: "member"; handle: string; displayName: string | null };

export type NpMediaListItem = NpMediaRecord & {
  uploader: NpMediaUploaderSummary | null;
};

export interface NpMediaResolvedUrls {
  original: string;
  thumbnail: string | null;
}

/** JSON shape returned by the Admin media list/detail APIs. */
export type NpMediaApiItem = NpMediaWireRecord & {
  urls: NpMediaResolvedUrls;
  uploader?: NpMediaUploaderSummary | null;
};
