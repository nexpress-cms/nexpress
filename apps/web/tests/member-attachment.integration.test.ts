import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import type { NpMediaAttachmentWire } from "@nexpress/core/media-contract";
import { forumCollections } from "@nexpress/plugin-forum";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import { PATCH as collectionPATCH } from "@/app/api/collections/[slug]/[id]/route";
import { GET as openApiGET } from "@/app/api/openapi.json/route";
import {
  GET as attachmentGET,
  HEAD as attachmentHEAD,
} from "@/app/api/media/attachments/[id]/route";
import { DELETE as attachmentDELETE } from "@/app/api/members/media/attachments/[id]/route";
import { POST as attachmentPOST } from "@/app/api/members/media/attachments/route";
import {
  forumBoardsTable,
  forumPostsAttachmentsTable,
  forumPostsTable,
} from "@/db/generated/collections";
import { NextRequest } from "next/server";

import {
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestMemberSession,
} from "./harness.js";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nattachment fixture\n%%EOF");

function memberHeaders(member: TestMemberSession): Headers {
  const headers = new Headers();
  headers.set("cookie", `np-mb-session=${member.sessionCookie}; np-mb-csrf=${member.csrfCookie}`);
  headers.set("x-csrf-token", member.csrfCookie);
  return headers;
}

function attachmentUploadRequest(
  member: TestMemberSession,
  file: { name: string; type: string; bytes: Uint8Array } = {
    name: "사용 안내.pdf",
    type: "application/pdf",
    bytes: PDF_BYTES,
  },
): NextRequest {
  const formData = new FormData();
  formData.append("file", new Blob([file.bytes], { type: file.type }), file.name);
  return new NextRequest("http://localhost:3000/api/members/media/attachments", {
    method: "POST",
    headers: memberHeaders(member),
    body: formData,
  });
}

function memberJsonRequest(
  path: string,
  member: TestMemberSession,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): NextRequest {
  const headers = memberHeaders(member);
  headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function downloadRequest(id: string, member?: TestMemberSession): NextRequest {
  return new NextRequest(`http://localhost:3000/api/media/attachments/${id}`, {
    headers: member ? memberHeaders(member) : undefined,
  });
}

async function uploadAttachment(member: TestMemberSession): Promise<NpMediaAttachmentWire> {
  const response = await attachmentPOST(attachmentUploadRequest(member));
  const result = await readJson<NpMediaAttachmentWire>(response);
  expect(result.status).toBe(202);
  return result.body;
}

describe.skipIf(skipIfNoTestDb())("member attachment contract", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { registerCollection } = await import("@nexpress/core");
    registerCollection("forum-boards", forumBoardsTable as never, forumCollections[0]);
    registerCollection("forum-posts", forumPostsTable as never, forumCollections[1], {
      childTables: { attachments: forumPostsAttachmentsTable as never },
    });
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function createBoard(
    overrides: Partial<{
      key: string;
      moderation: "published" | "pending";
      attachmentsEnabled: boolean;
      maxAttachments: number;
      maxAttachmentSizeMb: number;
    }> = {},
  ): Promise<string> {
    const staff = await seedUser({ role: "editor" });
    const response = await collectionPOST(
      new NextRequest("http://localhost:3000/api/collections/forum-boards", {
        method: "POST",
        headers: new Headers({
          "content-type": "application/json",
          cookie: `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`,
          "x-csrf-token": staff.csrfToken,
        }),
        body: JSON.stringify({
          key: overrides.key ?? `board-${Math.random().toString(36).slice(2)}`,
          name: "첨부 게시판",
          skin: "classic",
          writeMode: "members",
          moderation: overrides.moderation ?? "published",
          commentsEnabled: true,
          pageSize: 20,
          attachmentsEnabled: overrides.attachmentsEnabled ?? true,
          maxAttachments: overrides.maxAttachments ?? 5,
          maxAttachmentSizeMb: overrides.maxAttachmentSizeMb ?? 20,
          categories: [],
          _status: "published",
        }),
      }),
      { params: Promise.resolve({ slug: "forum-boards" }) },
    );
    const result = await readJson<{ id: string }>(response);
    expect(result.status).toBe(201);
    return result.body.id;
  }

  async function createPost(
    boardId: string,
    member: TestMemberSession,
    attachmentId: string,
  ): Promise<Response> {
    return collectionPOST(
      memberJsonRequest("/api/collections/forum-posts", member, "POST", {
        board: boardId,
        title: "첨부파일 계약",
        body: npCreateEmptyRichTextContent(),
        category: null,
        attachments: [{ file: attachmentId }],
      }),
      { params: Promise.resolve({ slug: "forum-posts" }) },
    );
  }

  it("validates bytes, returns an exact descriptor, and keeps unreferenced files owner-only", async () => {
    const owner = await seedActiveMember({ handle: "attachment-owner" });
    const intruder = await seedActiveMember({ handle: "attachment-intruder" });
    const attachment = await uploadAttachment(owner);

    expect(attachment).toEqual({
      id: expect.any(String),
      filename: "사용 안내.pdf",
      mimeType: "application/pdf",
      filesize: PDF_BYTES.byteLength,
      status: "ready",
      downloadUrl: `/api/media/attachments/${attachment.id}`,
    });

    const anonymous = await attachmentGET(downloadRequest(attachment.id), {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(anonymous.status).toBe(404);

    const ownerDownload = await attachmentGET(downloadRequest(attachment.id, owner), {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(ownerDownload.status).toBe(200);
    expect(ownerDownload.headers.get("content-type")).toBe("application/pdf");
    expect(ownerDownload.headers.get("content-disposition")).toContain("attachment;");
    expect(ownerDownload.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(ownerDownload.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ownerDownload.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
    expect(new Uint8Array(await ownerDownload.arrayBuffer())).toEqual(PDF_BYTES);

    const head = await attachmentHEAD(downloadRequest(attachment.id, owner), {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(PDF_BYTES.byteLength.toString());
    expect(await head.text()).toBe("");

    const intruderDelete = await attachmentDELETE(
      memberJsonRequest(`/api/members/media/attachments/${attachment.id}`, intruder, "DELETE"),
      { params: Promise.resolve({ id: attachment.id }) },
    );
    expect(intruderDelete.status).toBe(404);

    const removed = await attachmentDELETE(
      memberJsonRequest(`/api/members/media/attachments/${attachment.id}`, owner, "DELETE"),
      { params: Promise.resolve({ id: attachment.id }) },
    );
    expect(removed.status).toBe(200);
  });

  it("rejects extension, declared MIME, and content-signature spoofing before persistence", async () => {
    const member = await seedActiveMember({ handle: "attachment-spoof" });
    for (const file of [
      { name: "payload.svg", type: "image/svg+xml", bytes: new TextEncoder().encode("<svg/>") },
      { name: "payload.pdf", type: "text/html", bytes: PDF_BYTES },
      {
        name: "payload.pdf",
        type: "application/pdf",
        bytes: new TextEncoder().encode("<script>alert(1)</script>"),
      },
    ]) {
      const response = await attachmentPOST(attachmentUploadRequest(member, file));
      expect(response.status).toBe(400);
    }

    const extraField = new FormData();
    extraField.append("file", new Blob([PDF_BYTES], { type: "application/pdf" }), "guide.pdf");
    extraField.append("note", "unexpected");
    const extraFieldResponse = await attachmentPOST(
      new NextRequest("http://localhost:3000/api/members/media/attachments", {
        method: "POST",
        headers: memberHeaders(member),
        body: extraField,
      }),
    );
    expect(extraFieldResponse.status).toBe(400);

    const oversizedEnvelope = attachmentUploadRequest(member);
    oversizedEnvelope.headers.set("content-length", (26 * 1024 * 1024).toString());
    expect((await attachmentPOST(oversizedEnvelope)).status).toBe(400);
  });

  it("makes a published post attachment public while preventing referenced deletion", async () => {
    const owner = await seedActiveMember({ handle: "attachment-publisher" });
    const boardId = await createBoard();
    const attachment = await uploadAttachment(owner);
    const created = await createPost(boardId, owner, attachment.id);
    expect(created.status).toBe(201);

    const anonymous = await attachmentGET(downloadRequest(attachment.id), {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(anonymous.status).toBe(200);
    expect(new Uint8Array(await anonymous.arrayBuffer())).toEqual(PDF_BYTES);

    const removal = await attachmentDELETE(
      memberJsonRequest(`/api/members/media/attachments/${attachment.id}`, owner, "DELETE"),
      { params: Promise.resolve({ id: attachment.id }) },
    );
    expect(removal.status).toBe(409);
  });

  it("enforces board attachment policy and uploader ownership before saving the post", async () => {
    const owner = await seedActiveMember({ handle: "attachment-policy-owner" });
    const other = await seedActiveMember({ handle: "attachment-policy-other" });
    const attachment = await uploadAttachment(owner);
    const disabledBoardId = await createBoard({ attachmentsEnabled: false });
    expect((await createPost(disabledBoardId, owner, attachment.id)).status).toBe(400);

    const enabledBoardId = await createBoard();
    expect((await createPost(enabledBoardId, other, attachment.id)).status).toBe(403);

    const created = await createPost(enabledBoardId, owner, attachment.id);
    const createdResult = await readJson<{ id: string }>(created);
    expect(createdResult.status).toBe(201);
    const staff = await seedUser({ role: "editor" });
    const operatorSelectedAttachment = await uploadAttachment(other);
    const operatorEdit = await collectionPATCH(
      new NextRequest(
        `http://localhost:3000/api/collections/forum-posts/${createdResult.body.id}`,
        {
          method: "PATCH",
          headers: new Headers({
            "content-type": "application/json",
            cookie: `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`,
            "x-csrf-token": staff.csrfToken,
          }),
          body: JSON.stringify({
            attachments: [{ file: attachment.id }, { file: operatorSelectedAttachment.id }],
          }),
        },
      ),
      { params: Promise.resolve({ slug: "forum-posts", id: createdResult.body.id }) },
    );
    expect(operatorEdit.status).toBe(200);

    const disableBoard = await collectionPATCH(
      new NextRequest(`http://localhost:3000/api/collections/forum-boards/${enabledBoardId}`, {
        method: "PATCH",
        headers: new Headers({
          "content-type": "application/json",
          cookie: `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`,
          "x-csrf-token": staff.csrfToken,
        }),
        body: JSON.stringify({ attachmentsEnabled: false }),
      }),
      { params: Promise.resolve({ slug: "forum-boards", id: enabledBoardId }) },
    );
    expect(disableBoard.status).toBe(200);

    const preservingEdit = await collectionPATCH(
      memberJsonRequest(`/api/collections/forum-posts/${createdResult.body.id}`, owner, "PATCH", {
        title: "기존 첨부는 유지",
      }),
      { params: Promise.resolve({ slug: "forum-posts", id: createdResult.body.id }) },
    );
    const preservingResult = await readJson(preservingEdit);
    expect(preservingResult.status, JSON.stringify(preservingResult.body)).toBe(200);
  });

  it("publishes the exact upload, download, delete, and descriptor contracts in OpenAPI", async () => {
    const response = await openApiGET();
    const spec = (await response.json()) as {
      components: { schemas: Record<string, Record<string, unknown>> };
      paths: Record<string, Record<string, unknown>>;
    };

    expect(spec.components.schemas.media_attachment).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["id", "filename", "mimeType", "filesize", "status", "downloadUrl"],
    });
    expect(spec.paths["/api/members/media/attachments"]).toHaveProperty("post");
    expect(spec.paths["/api/members/media/attachments/{id}"]).toHaveProperty("delete");
    expect(spec.paths["/api/media/attachments/{id}"]).toMatchObject({
      get: { security: [] },
      head: { security: [] },
    });
  });
});
