import { describe, expect, it } from "vitest";

import { isNpMediaAttachmentWire, npRequireMediaAttachmentWire } from "../media-contract/index.js";
import type { NpMediaRecord } from "../media-contract/types.js";
import {
  npInspectMediaAttachmentUpload,
  npIsSupportedMediaAttachment,
  npToMediaAttachmentWire,
} from "./attachments.js";

const attachmentId = "ec6ff5a8-90cf-4388-917e-b4cf6b6ac76a";

function media(overrides: Partial<NpMediaRecord> = {}): NpMediaRecord {
  const timestamp = new Date("2026-07-20T00:00:00.000Z");
  return {
    id: attachmentId,
    siteId: "default",
    filename: "guide.pdf",
    originalFilename: "guide.pdf",
    mimeType: "application/pdf",
    filesize: 12,
    width: null,
    height: null,
    alt: null,
    caption: null,
    focalPoint: null,
    sizes: null,
    storageKey: "media/guide.pdf",
    hash: "hash",
    status: "ready",
    folderId: null,
    uploadedBy: null,
    uploadedByMemberId: "8a1ea317-9c6e-4f2a-83ec-1c31ed1745e2",
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

function zipWithEntries(names: readonly string[], comment = Buffer.alloc(0)): Buffer {
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let localOffset = 0;
  for (const name of names) {
    const encoded = Buffer.from(name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(encoded.byteLength, 26);
    localParts.push(localHeader, encoded);

    const directoryHeader = Buffer.alloc(46);
    directoryHeader.writeUInt32LE(0x02014b50, 0);
    directoryHeader.writeUInt16LE(20, 4);
    directoryHeader.writeUInt16LE(20, 6);
    directoryHeader.writeUInt16LE(encoded.byteLength, 28);
    directoryHeader.writeUInt32LE(localOffset, 42);
    directoryParts.push(directoryHeader, encoded);
    localOffset += localHeader.byteLength + encoded.byteLength;
  }
  const directory = Buffer.concat(directoryParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(directory.byteLength, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(comment.byteLength, 20);
  return Buffer.concat([...localParts, directory, eocd, comment]);
}

function zipLookalikeWithLocalNames(names: readonly string[]): Buffer {
  return Buffer.concat([
    ...names.map((name) => {
      const encoded = Buffer.from(name, "utf8");
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(encoded.byteLength, 26);
      return Buffer.concat([header, encoded]);
    }),
    Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  ]);
}

function oleWithStream(name: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(504),
    Buffer.from(name, "utf16le"),
  ]);
}

describe("media attachment contracts", () => {
  it("accepts a supported extension only when the declared type and bytes agree", () => {
    const inspected = npInspectMediaAttachmentUpload(
      "사용 안내.PDF",
      "application/pdf",
      Buffer.from("%PDF-1.7\nbody", "utf8"),
    );

    expect(inspected).toEqual({
      ok: true,
      filename: "사용 안내.PDF",
      mimeType: "application/pdf",
    });
    expect(
      npInspectMediaAttachmentUpload(
        "spoofed.pdf",
        "application/pdf",
        Buffer.from("<script>alert(1)</script>", "utf8"),
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("contents") });
    expect(
      npInspectMediaAttachmentUpload(
        "photo.png",
        "application/pdf",
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("content type") });
  });

  it("rejects unsafe names, unsupported extensions, binary text, and empty files", () => {
    expect(
      npInspectMediaAttachmentUpload("../secret.txt", "text/plain", Buffer.from("secret")),
    ).toMatchObject({ ok: false, message: expect.stringContaining("basename") });
    expect(
      npInspectMediaAttachmentUpload("payload.svg", "image/svg+xml", Buffer.from("<svg/>")),
    ).toMatchObject({ ok: false, message: expect.stringContaining("Unsupported") });
    expect(
      npInspectMediaAttachmentUpload("binary.txt", "text/plain", Buffer.from([0x61, 0x00, 0x62])),
    ).toMatchObject({ ok: false, message: expect.stringContaining("contents") });
    expect(
      npInspectMediaAttachmentUpload("empty.txt", "text/plain", Buffer.alloc(0)),
    ).toMatchObject({ ok: false, message: expect.stringContaining("Empty") });
    expect(
      npInspectMediaAttachmentUpload(
        "report\u202Efdp.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.7"),
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("basename") });
    expect(
      npInspectMediaAttachmentUpload(" report.pdf", "application/pdf", Buffer.from("%PDF-1.7")),
    ).toMatchObject({ ok: false, message: expect.stringContaining("basename") });
    expect(
      npInspectMediaAttachmentUpload(
        "legacy-korean.txt",
        "text/plain",
        Buffer.from([0xb0, 0xa1, 0xb3, 0xaa]),
      ),
    ).toMatchObject({ ok: true, mimeType: "text/plain" });
  });

  it("requires ZIP-based office formats to contain their canonical package entries", () => {
    const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(
      npInspectMediaAttachmentUpload(
        "guide.docx",
        mime,
        zipWithEntries(["[Content_Types].xml", "word/document.xml"]),
      ),
    ).toMatchObject({ ok: true, mimeType: mime });
    expect(
      npInspectMediaAttachmentUpload("fake.docx", mime, zipWithEntries(["payload.txt"])),
    ).toMatchObject({ ok: false, message: expect.stringContaining("contents") });
    expect(
      npInspectMediaAttachmentUpload(
        "lookalike.docx",
        mime,
        zipLookalikeWithLocalNames(["[Content_Types].xml", "word/document.xml"]),
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("contents") });
    expect(
      npInspectMediaAttachmentUpload(
        "commented.zip",
        "application/zip",
        zipWithEntries(["readme.txt"], Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0])),
      ),
    ).toMatchObject({ ok: true, mimeType: "application/zip" });
  });

  it("distinguishes legacy OLE document families by their canonical stream names", () => {
    expect(
      npInspectMediaAttachmentUpload("guide.hwp", "application/x-hwp", oleWithStream("FileHeader")),
    ).toMatchObject({ ok: true, mimeType: "application/x-hwp" });
    expect(
      npInspectMediaAttachmentUpload(
        "spoofed.doc",
        "application/msword",
        oleWithStream("Workbook"),
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("contents") });
  });

  it("projects one exact client-safe descriptor and rejects extra wire fields", () => {
    const wire = npToMediaAttachmentWire(media());

    expect(wire).toEqual({
      id: attachmentId,
      filename: "guide.pdf",
      mimeType: "application/pdf",
      filesize: 12,
      status: "ready",
      downloadUrl: `/api/media/attachments/${attachmentId}`,
    });
    expect(isNpMediaAttachmentWire(wire)).toBe(true);
    expect(isNpMediaAttachmentWire({ ...wire, storageKey: "private/key" })).toBe(false);
    expect(isNpMediaAttachmentWire({ ...wire, filename: "guide.svg" })).toBe(false);
    expect(isNpMediaAttachmentWire({ ...wire, mimeType: "text/plain" })).toBe(false);
    expect(isNpMediaAttachmentWire({ ...wire, status: "error" })).toBe(false);
    expect(() => npRequireMediaAttachmentWire({ ...wire, filesize: 0 })).toThrow(
      /Invalid media attachment response/u,
    );
  });

  it("fails closed for persisted rows whose extension and canonical MIME disagree", () => {
    expect(npIsSupportedMediaAttachment(media())).toBe(true);
    expect(npIsSupportedMediaAttachment(media({ status: "error" }))).toBe(false);
    expect(npIsSupportedMediaAttachment(media({ mimeType: "text/html" }))).toBe(false);
    expect(npIsSupportedMediaAttachment(media({ filesize: 25 * 1024 * 1024 + 1 }))).toBe(false);
    expect(() => npToMediaAttachmentWire(media({ filename: "payload.svg" }))).toThrow(
      /not a supported attachment/u,
    );
  });
});
