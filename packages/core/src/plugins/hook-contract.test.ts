import { describe, expect, expectTypeOf, it } from "vitest";

import {
  npIsPluginHookName,
  npPluginHookNames,
  npValidatePluginHookData,
  type NpPluginHookDataMap,
  type NpPluginHookName,
} from "./hook-contract.js";

const staffPrincipal = {
  kind: "staff" as const,
  user: {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    role: "admin" as const,
    tokenVersion: 0,
  },
};

const memberPrincipal = { kind: "member" as const, memberId: "member-1" };
const document = { id: "doc-1", title: "Hello" };
const originalDocument = { id: "doc-1", title: "Before" };

const validData = {
  "content:beforeCreate": {
    collection: "posts",
    documentId: null,
    document,
    originalDocument: null,
    operation: "create",
    source: "request",
    principal: staffPrincipal,
  },
  "content:afterCreate": {
    collection: "posts",
    documentId: "doc-1",
    document,
    originalDocument: null,
    operation: "create",
    source: "request",
    principal: staffPrincipal,
  },
  "content:beforeUpdate": {
    collection: "posts",
    documentId: "doc-1",
    document,
    originalDocument,
    operation: "update",
    source: "request",
    principal: staffPrincipal,
  },
  "content:afterUpdate": {
    collection: "posts",
    documentId: "doc-1",
    document,
    originalDocument: null,
    operation: "update",
    source: "scheduler",
    principal: null,
  },
  "content:beforeDelete": {
    collection: "posts",
    documentId: "doc-1",
    document,
    originalDocument: null,
    operation: "delete",
    source: "request",
    principal: memberPrincipal,
  },
  "content:afterDelete": {
    collection: "posts",
    documentId: "doc-1",
    document,
    originalDocument: null,
    operation: "delete",
    source: "request",
    principal: memberPrincipal,
  },
  "content:beforePublish": {
    collection: "posts",
    documentId: "doc-1",
    document,
    originalDocument,
    operation: "update",
    source: "request",
    principal: staffPrincipal,
  },
  "content:afterPublish": {
    collection: "posts",
    documentId: "doc-1",
    document,
    originalDocument,
    operation: "update",
    source: "request",
    principal: staffPrincipal,
  },
  "content:beforeUnpublish": {
    collection: "posts",
    documentId: "doc-1",
    document,
    originalDocument,
    operation: "update",
    source: "request",
    principal: staffPrincipal,
  },
  "auth:afterLogin": {
    user: { id: "user-1", email: "admin@example.com", role: "admin" },
  },
  "auth:beforeLogout": {
    user: { id: "user-1", email: "admin@example.com", role: "admin" },
  },
  "auth:afterRegister": {
    user: { id: "user-1", email: "admin@example.com", role: "admin" },
    origin: "invite",
  },
  "render:beforePage": {
    collection: "pages",
    slug: "hello",
    document,
  },
  "media:beforeUpload": {
    principal: memberPrincipal,
    member: {
      id: "member-1",
      email: "member@example.com",
      handle: "member",
      displayName: "Member",
    },
    file: { filename: "photo.png", mimeType: "image/png", size: 42 },
    folderId: null,
  },
  "media:afterUpload": {
    principal: staffPrincipal,
    member: null,
    media: {
      id: "media-1",
      status: "ready",
      filename: "photo.png",
      mimeType: "image/png",
      size: 42,
      folderId: "folder-1",
    },
  },
} satisfies NpPluginHookDataMap;

describe("plugin hook contract", () => {
  it("keeps one runtime inventory aligned with the typed data map", () => {
    expect(Object.keys(validData)).toEqual(npPluginHookNames);
    expectTypeOf<keyof NpPluginHookDataMap>().toEqualTypeOf<NpPluginHookName>();

    for (const hookName of npPluginHookNames) {
      expect(npValidatePluginHookData(hookName, validData[hookName])).toEqual({ ok: true });
    }
  });

  it("recognizes only canonical hook names", () => {
    expect(npIsPluginHookName("content:afterCreate")).toBe(true);
    expect(npIsPluginHookName("content:afterSave")).toBe(false);
    expect(npValidatePluginHookData("content:afterSave", validData["content:afterCreate"])).toEqual(
      {
        ok: false,
        message: 'Unsupported plugin hook "content:afterSave".',
      },
    );
  });

  it.each([
    ["content:afterCreate", { collection: "posts", doc: document }, /canonical content/],
    [
      "content:afterUpdate",
      { ...validData["content:afterUpdate"], principal: staffPrincipal },
      /source and data.principal/,
    ],
    [
      "auth:afterRegister",
      { ...validData["auth:afterRegister"], origin: "signup" },
      /admin or invite/,
    ],
    [
      "media:beforeUpload",
      { ...validData["media:beforeUpload"], member: { id: "someone-else" } },
      /must match/,
    ],
    ["render:beforePage", { ...validData["render:beforePage"], path: "/hello" }, /no extra fields/],
  ] satisfies Array<[NpPluginHookName, unknown, RegExp]>)(
    "rejects malformed %s payloads",
    (hookName, value, message) => {
      const result = npValidatePluginHookData(hookName, value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(message);
    },
  );
});
