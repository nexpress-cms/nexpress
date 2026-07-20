import { extname } from "node:path";

import {
  npMediaAttachmentExtensions,
  npMediaAttachmentLimits,
  npMediaAttachmentMimeTypes,
  npIsSafeMediaAttachmentFilename,
  npRequireMediaAttachmentWire,
  type NpMediaAttachmentExtension,
  type NpMediaAttachmentStatus,
  type NpMediaAttachmentWire,
} from "../media-contract/attachments.js";
import type { NpMediaRecord } from "../media-contract/types.js";

type SignatureKind =
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "pdf"
  | "zip"
  | "hwpx"
  | "docx"
  | "xlsx"
  | "pptx"
  | "odf"
  | "sevenZip"
  | "rar"
  | "gzip"
  | "text"
  | "hwpOle"
  | "docOle"
  | "xlsOle"
  | "pptOle";

interface AttachmentTypeDefinition {
  declaredMimeTypes: readonly string[];
  signature: SignatureKind;
}

const octetStream = "application/octet-stream";
const attachmentTypes: Readonly<Record<NpMediaAttachmentExtension, AttachmentTypeDefinition>> = {
  png: { declaredMimeTypes: ["image/png"], signature: "png" },
  jpg: { declaredMimeTypes: ["image/jpeg"], signature: "jpeg" },
  jpeg: { declaredMimeTypes: ["image/jpeg"], signature: "jpeg" },
  gif: { declaredMimeTypes: ["image/gif"], signature: "gif" },
  webp: { declaredMimeTypes: ["image/webp"], signature: "webp" },
  pdf: {
    declaredMimeTypes: ["application/pdf"],
    signature: "pdf",
  },
  zip: {
    declaredMimeTypes: ["application/zip", "application/x-zip-compressed"],
    signature: "zip",
  },
  "7z": {
    declaredMimeTypes: ["application/x-7z-compressed"],
    signature: "sevenZip",
  },
  rar: {
    declaredMimeTypes: ["application/vnd.rar", "application/x-rar-compressed"],
    signature: "rar",
  },
  gz: {
    declaredMimeTypes: ["application/gzip", "application/x-gzip"],
    signature: "gzip",
  },
  txt: {
    declaredMimeTypes: ["text/plain"],
    signature: "text",
  },
  csv: {
    declaredMimeTypes: ["text/csv", "text/plain", "application/vnd.ms-excel"],
    signature: "text",
  },
  md: {
    declaredMimeTypes: ["text/markdown", "text/plain"],
    signature: "text",
  },
  hwp: {
    declaredMimeTypes: [
      "application/x-hwp",
      "application/haansofthwp",
      "application/vnd.hancom.hwp",
    ],
    signature: "hwpOle",
  },
  hwpx: {
    declaredMimeTypes: [
      "application/vnd.hancom.hwpx",
      "application/haansofthwpx",
      "application/zip",
      "application/x-zip-compressed",
    ],
    signature: "hwpx",
  },
  doc: {
    declaredMimeTypes: ["application/msword"],
    signature: "docOle",
  },
  docx: {
    declaredMimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    signature: "docx",
  },
  xls: {
    declaredMimeTypes: ["application/vnd.ms-excel"],
    signature: "xlsOle",
  },
  xlsx: {
    declaredMimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    signature: "xlsx",
  },
  ppt: {
    declaredMimeTypes: ["application/vnd.ms-powerpoint"],
    signature: "pptOle",
  },
  pptx: {
    declaredMimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    signature: "pptx",
  },
  odt: {
    declaredMimeTypes: ["application/vnd.oasis.opendocument.text"],
    signature: "odf",
  },
  ods: {
    declaredMimeTypes: ["application/vnd.oasis.opendocument.spreadsheet"],
    signature: "odf",
  },
  odp: {
    declaredMimeTypes: ["application/vnd.oasis.opendocument.presentation"],
    signature: "odf",
  },
};

export type NpMediaAttachmentInspection =
  { ok: true; filename: string; mimeType: string } | { ok: false; message: string };

export function npInspectMediaAttachmentUpload(
  originalFilename: string,
  declaredMimeType: string,
  buffer: Buffer,
): NpMediaAttachmentInspection {
  const filename = originalFilename.normalize("NFC");
  if (!npIsSafeMediaAttachmentFilename(filename)) {
    return { ok: false, message: "File name must be a safe basename of at most 255 characters." };
  }
  if (buffer.byteLength === 0) return { ok: false, message: "Empty files are not accepted." };
  if (buffer.byteLength > npMediaAttachmentLimits.maxFileSizeBytes) {
    return {
      ok: false,
      message: `File exceeds max size of ${npMediaAttachmentLimits.maxFileSizeBytes.toString()} bytes.`,
    };
  }

  const extension = extname(filename).slice(1).toLowerCase();
  if (!(npMediaAttachmentExtensions as readonly string[]).includes(extension)) {
    return {
      ok: false,
      message: `Unsupported attachment type. Allowed extensions: ${npMediaAttachmentExtensions.join(", ")}.`,
    };
  }
  const definition = attachmentTypes[extension as NpMediaAttachmentExtension];
  const declared = declaredMimeType.trim().toLowerCase();
  if (declared && declared !== octetStream && !definition.declaredMimeTypes.includes(declared)) {
    return { ok: false, message: "File extension and declared content type do not match." };
  }
  if (!matchesSignature(definition.signature, buffer)) {
    return { ok: false, message: "File contents do not match the selected attachment type." };
  }
  return {
    ok: true,
    filename,
    mimeType: npMediaAttachmentMimeTypes[extension as NpMediaAttachmentExtension],
  };
}

export function npIsSupportedMediaAttachment(
  record: NpMediaRecord,
): record is NpMediaRecord & { status: NpMediaAttachmentStatus } {
  if (record.status === "error") return false;
  if (!npIsSafeMediaAttachmentFilename(record.filename)) return false;
  if (
    !Number.isSafeInteger(record.filesize) ||
    record.filesize <= 0 ||
    record.filesize > npMediaAttachmentLimits.maxFileSizeBytes
  ) {
    return false;
  }
  const extension = extname(record.filename).slice(1).toLowerCase();
  if (!(npMediaAttachmentExtensions as readonly string[]).includes(extension)) return false;
  return record.mimeType === npMediaAttachmentMimeTypes[extension as NpMediaAttachmentExtension];
}

export function npToMediaAttachmentWire(record: NpMediaRecord): NpMediaAttachmentWire {
  if (!npIsSupportedMediaAttachment(record)) {
    throw new Error(`Media ${record.id} is not a supported attachment.`);
  }
  return npRequireMediaAttachmentWire({
    id: record.id,
    filename: record.filename,
    mimeType: record.mimeType,
    filesize: record.filesize,
    status: record.status,
    downloadUrl: `/api/media/attachments/${record.id}`,
  });
}

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((value, index) => buffer[offset + index] === value);
}

function matchesSignature(kind: SignatureKind, buffer: Buffer): boolean {
  switch (kind) {
    case "png":
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpeg":
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case "gif":
      return (
        startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      );
    case "webp":
      return (
        startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case "pdf":
      return startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "zip":
      return isZip(buffer);
    case "hwpx":
      return hasZipEntries(buffer, ["Contents/", "META-INF/manifest.xml"]);
    case "docx":
      return hasZipEntries(buffer, ["[Content_Types].xml", "word/"]);
    case "xlsx":
      return hasZipEntries(buffer, ["[Content_Types].xml", "xl/"]);
    case "pptx":
      return hasZipEntries(buffer, ["[Content_Types].xml", "ppt/"]);
    case "odf":
      return hasZipEntries(buffer, ["mimetype", "META-INF/manifest.xml", "content.xml"]);
    case "sevenZip":
      return startsWith(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    case "rar":
      return (
        startsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]) ||
        startsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
      );
    case "gzip":
      return startsWith(buffer, [0x1f, 0x8b]);
    case "hwpOle":
      return hasOleStream(buffer, ["FileHeader"]);
    case "docOle":
      return hasOleStream(buffer, ["WordDocument"]);
    case "xlsOle":
      return hasOleStream(buffer, ["Workbook", "Book"]);
    case "pptOle":
      return hasOleStream(buffer, ["PowerPoint Document"]);
    case "text":
      return isAcceptedText(buffer);
  }
}

function hasOleStream(buffer: Buffer, streamNames: readonly string[]): boolean {
  if (buffer.length < 512) return false;
  if (!startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return false;
  return streamNames.some((name) => buffer.includes(Buffer.from(name, "utf16le")));
}

function isZip(buffer: Buffer): boolean {
  const startsWithArchive =
    startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]);
  if (!startsWithArchive) return false;
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  return buffer.lastIndexOf(eocd) >= Math.max(0, buffer.length - (22 + 65_535));
}

function hasZipEntries(buffer: Buffer, required: readonly string[]): boolean {
  if (!isZip(buffer)) return false;
  const entries = readZipEntryNames(buffer);
  return required.every((expected) =>
    expected.endsWith("/")
      ? entries.some((entry) => entry.startsWith(expected))
      : entries.includes(expected),
  );
}

function readZipEntryNames(buffer: Buffer): string[] {
  const names: string[] = [];
  const signatures = [
    { bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]), headerSize: 30, nameOffset: 26 },
    { bytes: Buffer.from([0x50, 0x4b, 0x01, 0x02]), headerSize: 46, nameOffset: 28 },
  ];
  for (const signature of signatures) {
    let offset = 0;
    let scans = 0;
    while (names.length < 4096 && scans < 8192) {
      scans += 1;
      const index = buffer.indexOf(signature.bytes, offset);
      if (index < 0) break;
      if (index + signature.headerSize > buffer.length) break;
      const nameLength = buffer.readUInt16LE(index + signature.nameOffset);
      const nameStart = index + signature.headerSize;
      const nameEnd = nameStart + nameLength;
      if (nameLength > 0 && nameEnd <= buffer.length) {
        try {
          const name = new TextDecoder("utf-8", { fatal: true }).decode(
            buffer.subarray(nameStart, nameEnd),
          );
          if (!name.includes("\u0000")) names.push(name);
        } catch {
          // Invalid entry names do not contribute to the container contract.
        }
      }
      offset = Math.max(index + 4, nameEnd);
    }
  }
  return names;
}

function isAcceptedText(buffer: Buffer): boolean {
  for (const encoding of ["utf-8", "euc-kr"] as const) {
    try {
      const value = new TextDecoder(encoding, { fatal: true }).decode(buffer);
      if (
        !Array.from(value).some((character) => {
          const code = character.charCodeAt(0);
          return (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
        })
      ) {
        return true;
      }
    } catch {
      // Try the next explicitly supported text encoding.
    }
  }
  return false;
}
