export const npMediaAttachmentLimits = {
  maxFilesPerDocument: 20,
  maxFileSizeBytes: 25 * 1024 * 1024,
  filenameLength: 255,
} as const;

export const npMediaAttachmentExtensions = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "pdf",
  "zip",
  "7z",
  "rar",
  "gz",
  "txt",
  "csv",
  "md",
  "hwp",
  "hwpx",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
] as const;

export type NpMediaAttachmentExtension = (typeof npMediaAttachmentExtensions)[number];

export const npMediaAttachmentMimeTypes = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
} as const satisfies Readonly<Record<NpMediaAttachmentExtension, string>>;

export const npMediaAttachmentStatuses = ["processing", "ready"] as const;
export type NpMediaAttachmentStatus = (typeof npMediaAttachmentStatuses)[number];

export const npMediaAttachmentAccept = npMediaAttachmentExtensions
  .map((extension) => `.${extension}`)
  .join(",");

/** Exact client-safe descriptor returned by the member attachment API. */
export interface NpMediaAttachmentWire {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  status: NpMediaAttachmentStatus;
  downloadUrl: string;
}

const attachmentKeys = new Set(["id", "filename", "mimeType", "filesize", "status", "downloadUrl"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const mimeTypePattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function npIsSafeMediaAttachmentFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= npMediaAttachmentLimits.filenameLength &&
    value === value.normalize("NFC") &&
    value === value.trim() &&
    !/[/\\]/u.test(value) &&
    !hasUnsafeFilenameCharacter(value)
  );
}

function hasUnsafeFilenameCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
}

function attachmentExtension(filename: string): NpMediaAttachmentExtension | null {
  const separator = filename.lastIndexOf(".");
  if (separator <= 0 || separator === filename.length - 1) return null;
  const extension = filename.slice(separator + 1).toLowerCase();
  return (npMediaAttachmentExtensions as readonly string[]).includes(extension)
    ? (extension as NpMediaAttachmentExtension)
    : null;
}

export function isNpMediaAttachmentWire(value: unknown): value is NpMediaAttachmentWire {
  if (!isPlainRecord(value)) return false;
  if (Object.keys(value).some((key) => !attachmentKeys.has(key))) return false;
  if (Object.keys(value).length !== attachmentKeys.size) return false;
  if (typeof value.id !== "string" || !uuidPattern.test(value.id)) return false;
  if (!npIsSafeMediaAttachmentFilename(value.filename)) return false;
  const extension = attachmentExtension(value.filename);
  if (!extension) return false;
  if (typeof value.mimeType !== "string" || !mimeTypePattern.test(value.mimeType)) return false;
  if (value.mimeType !== npMediaAttachmentMimeTypes[extension]) return false;
  if (
    typeof value.filesize !== "number" ||
    !Number.isSafeInteger(value.filesize) ||
    value.filesize <= 0 ||
    value.filesize > npMediaAttachmentLimits.maxFileSizeBytes
  ) {
    return false;
  }
  if (!(npMediaAttachmentStatuses as readonly unknown[]).includes(value.status)) return false;
  return value.downloadUrl === `/api/media/attachments/${value.id}`;
}

export function npRequireMediaAttachmentWire(value: unknown): NpMediaAttachmentWire {
  if (!isNpMediaAttachmentWire(value)) {
    throw new Error("Invalid media attachment response.");
  }
  return value;
}
