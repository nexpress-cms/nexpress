import {
  NpValidationError,
  NpForbiddenError,
  defineCollection,
  findDocuments,
  isEditorOrAbove,
  type NpCollectionConfig,
  type NpPrincipal,
} from "@nexpress/core";
import {
  getMediaById,
  npIsSupportedMediaAttachment,
  npMediaAttachmentLimits,
} from "@nexpress/core/media";

import {
  findForumBoardById,
  getForumBoardById,
  npForumBoardKeyPattern,
  normalizeForumAttachmentIds,
  normalizeForumCategories,
  type ForumPostDocument,
  type NpForumRuntime,
} from "./runtime.js";
import type { NpForumBoard } from "./types.js";

function validateBoardDefinition(data: Record<string, unknown>): Record<string, unknown> {
  if (typeof data.key !== "string" || !npForumBoardKeyPattern.test(data.key)) {
    throw new NpValidationError("Invalid forum board key", [
      {
        field: "key",
        message: "Use 2–63 lowercase letters, digits, and hyphens, starting with a letter.",
      },
    ]);
  }
  try {
    normalizeForumCategories(data.categories);
  } catch (error) {
    throw new NpValidationError("Invalid forum board categories", [
      {
        field: "categories",
        message: error instanceof Error ? error.message : "Invalid categories.",
      },
    ]);
  }
  return data;
}

function validateStableCategoryKeys(
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null | undefined,
): void {
  if (!originalDoc) return;
  const nextKeys = new Set(
    normalizeForumCategories(data.categories).map((category) => category.key),
  );
  const removed = normalizeForumCategories(originalDoc.categories).find(
    (category) => !nextKeys.has(category.key),
  );
  if (!removed) return;
  throw new NpValidationError("Forum board category keys cannot be removed", [
    {
      field: "categories",
      message: `Keep the stable category key "${removed.key}"; its label may still be changed.`,
    },
  ]);
}

function categoryAllowed(board: NpForumBoard, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  return typeof value === "string" && board.categories.some((category) => category.key === value);
}

async function boardAllowsMemberWrite(
  runtime: NpForumRuntime,
  data: Readonly<Record<string, unknown>>,
): Promise<NpForumBoard | null> {
  const boardId = data.board;
  if (typeof boardId !== "string") return null;
  const board = await findForumBoardById(runtime, boardId);
  if (!board || board.writeMode !== "members" || !categoryAllowed(board, data.category)) {
    return null;
  }
  return board;
}

async function boardAllowsMemberUpdate(
  runtime: NpForumRuntime,
  data: Readonly<Record<string, unknown>>,
): Promise<NpForumBoard | null> {
  const boardId = data.board;
  if (typeof boardId !== "string") return null;
  const board = await findForumBoardById(runtime, boardId);
  return board && categoryAllowed(board, data.category) ? board : null;
}

async function validateForumAttachments(
  board: NpForumBoard,
  data: Readonly<Record<string, unknown>>,
  principal: NpPrincipal | null | undefined,
  originalAttachments?: unknown,
): Promise<void> {
  let ids: string[];
  try {
    ids = normalizeForumAttachmentIds(data.attachments);
  } catch (error) {
    throw new NpValidationError("Invalid forum attachments", [
      {
        field: "attachments",
        message: error instanceof Error ? error.message : "Invalid attachment list.",
      },
    ]);
  }
  const originalIds = new Set(normalizeForumAttachmentIds(originalAttachments));
  const addedIds = new Set(ids.filter((id) => !originalIds.has(id)));
  if (!board.attachments.enabled && addedIds.size > 0) {
    throw new NpValidationError("Forum attachments are disabled", [
      { field: "attachments", message: "This board does not accept attachments." },
    ]);
  }
  if (ids.length > board.attachments.maxFiles && addedIds.size > 0) {
    throw new NpValidationError("Too many forum attachments", [
      {
        field: "attachments",
        message: `This board accepts at most ${board.attachments.maxFiles.toString()} attachments.`,
      },
    ]);
  }

  const records = await Promise.all(ids.map((id) => getMediaById(id)));
  for (const [index, media] of records.entries()) {
    if (!media || !npIsSupportedMediaAttachment(media)) {
      throw new NpValidationError("Invalid forum attachment", [
        {
          field: `attachments.${index.toString()}.file`,
          message: "Select a supported, active media attachment.",
        },
      ]);
    }
    if (addedIds.has(media.id) && media.filesize > board.attachments.maxFileSizeBytes) {
      throw new NpValidationError("Forum attachment is too large", [
        {
          field: `attachments.${index.toString()}.file`,
          message: `This board limits each attachment to ${board.attachments.maxFileSizeBytes.toString()} bytes.`,
        },
      ]);
    }
    if (
      principal?.kind === "member" &&
      addedIds.has(media.id) &&
      media.uploadedByMemberId !== principal.memberId
    ) {
      throw new NpForbiddenError("forum attachment", "use");
    }
  }
}

export function defineForumBoardsCollection(runtime: NpForumRuntime): NpCollectionConfig {
  const skinOptions = [...runtime.skins.values()].map((skin) => ({
    label: skin.label,
    value: skin.id,
  }));

  return defineCollection({
    slug: runtime.collections.boards,
    labels: { singular: "Forum board", plural: "Forum boards" },
    slugField: { useField: "key", unique: true },
    admin: {
      group: "Community",
      listColumns: ["name", "key", "skin", "writeMode", "moderation", "status"],
      defaultSort: "name",
      description:
        "Create and configure public boards without adding another collection or migration.",
    },
    versions: { drafts: true, max: 20 },
    community: { follows: true },
    access: {
      read: () => true,
      create: isEditorOrAbove,
      update: isEditorOrAbove,
      delete: isEditorOrAbove,
    },
    hooks: {
      beforeCreate: [({ data }) => validateBoardDefinition(data)],
      beforeUpdate: [
        ({ data, originalDoc }) => {
          if (originalDoc && data.key !== originalDoc.key) {
            throw new NpValidationError("Forum board key cannot be changed", [
              {
                field: "key",
                message: "Create a new board instead of changing its stable URL key.",
              },
            ]);
          }
          const validated = validateBoardDefinition(data);
          validateStableCategoryKeys(validated, originalDoc);
          return validated;
        },
      ],
      beforeDelete: [
        async ({ data }) => {
          const boardId = typeof data.id === "string" ? data.id : null;
          if (!boardId) return data;
          const posts = await findDocuments<ForumPostDocument>(runtime.collections.posts, {
            where: { board: boardId, visibility: "*" },
            page: 1,
            limit: 1,
          });
          if (posts.totalDocs > 0) {
            throw new NpValidationError("Forum board still has posts", [
              {
                field: "board",
                message: "Move or delete every post in this board before deleting the board.",
              },
            ]);
          }
          return data;
        },
      ],
    },
    seo: {
      urlPath: (doc) => (typeof doc.slug === "string" ? `${runtime.basePath}/${doc.slug}` : null),
      changefreq: "daily",
      priority: 0.7,
    },
    fields: [
      {
        type: "text",
        name: "key",
        label: "Board key",
        required: true,
        minLength: 2,
        maxLength: 63,
        unique: true,
        admin: {
          description: "Stable URL key, for example free or announcements.",
          placeholder: "free",
        },
      },
      {
        type: "text",
        name: "name",
        required: true,
        maxLength: 120,
        admin: { kind: "title", placeholder: "자유게시판" },
      },
      {
        type: "textarea",
        name: "description",
        maxLength: 500,
        rows: 3,
      },
      {
        type: "select",
        name: "skin",
        required: true,
        defaultValue: runtime.defaultSkinId,
        options: skinOptions,
        admin: { position: "sidebar", group: "Board" },
      },
      {
        type: "select",
        name: "writeMode",
        label: "Who can create posts",
        required: true,
        defaultValue: "members",
        options: [
          { label: "Members", value: "members" },
          { label: "Staff only", value: "staff" },
          { label: "Closed", value: "closed" },
        ],
        admin: { position: "sidebar", group: "Board" },
      },
      {
        type: "select",
        name: "moderation",
        label: "New member posts",
        required: true,
        defaultValue: "published",
        options: [
          { label: "Publish immediately", value: "published" },
          { label: "Hold for review", value: "pending" },
        ],
        admin: { position: "sidebar", group: "Board" },
      },
      {
        type: "checkbox",
        name: "commentsEnabled",
        label: "Allow comments on new posts",
        required: true,
        defaultValue: true,
        admin: { position: "sidebar", group: "Board" },
      },
      {
        type: "number",
        name: "pageSize",
        label: "Posts per page",
        required: true,
        defaultValue: 20,
        min: 5,
        max: 100,
        integerOnly: true,
        admin: { position: "sidebar", group: "Board" },
      },
      {
        type: "checkbox",
        name: "attachmentsEnabled",
        label: "Allow attachments",
        required: true,
        defaultValue: true,
        admin: { position: "sidebar", group: "Attachments" },
      },
      {
        type: "number",
        name: "maxAttachments",
        label: "Maximum attachments per post",
        required: true,
        defaultValue: 5,
        min: 1,
        max: npMediaAttachmentLimits.maxFilesPerDocument,
        integerOnly: true,
        admin: { position: "sidebar", group: "Attachments" },
      },
      {
        type: "number",
        name: "maxAttachmentSizeMb",
        label: "Maximum size per attachment (MB)",
        required: true,
        defaultValue: 20,
        min: 1,
        max: npMediaAttachmentLimits.maxFileSizeBytes / (1024 * 1024),
        integerOnly: true,
        admin: { position: "sidebar", group: "Attachments" },
      },
      {
        type: "array",
        name: "categories",
        label: "Categories",
        maxRows: 50,
        admin: {
          description: "Optional per-board categories. Keys stay stable after posts use them.",
        },
        fields: [
          {
            type: "text",
            name: "key",
            required: true,
            minLength: 1,
            maxLength: 63,
            admin: { placeholder: "question" },
          },
          {
            type: "text",
            name: "label",
            required: true,
            maxLength: 80,
            admin: { placeholder: "질문" },
          },
        ],
      },
    ],
  });
}

export function defineForumPostsCollection(runtime: NpForumRuntime): NpCollectionConfig {
  return defineCollection({
    slug: runtime.collections.posts,
    labels: { singular: "Forum post", plural: "Forum posts" },
    admin: {
      group: "Community",
      listColumns: ["title", "board", "category", "status", "pinned", "locked", "updatedAt"],
      defaultSort: "-updatedAt",
      description: "Member and staff posts across all configured forum boards.",
    },
    versions: { drafts: true, max: 30 },
    community: {
      comments: true,
      reactions: true,
      views: true,
      follows: true,
      reports: true,
      moderation: {
        categoryField: "board",
        hiddenField: "moderationHidden",
        lockField: "locked",
        pinField: "pinned",
      },
      profileActivity: { documents: true, comments: true },
      memberWrite: {
        create: true,
        update: true,
        delete: true,
        writableFields: ["board", "title", "body", "category", "attachments"],
        access: {
          create: async ({ data }) =>
            data !== null && (await boardAllowsMemberWrite(runtime, data)) !== null,
          update: async ({ data, originalDoc }) => {
            if (!data || !originalDoc || data.board !== originalDoc.board) return false;
            return (await boardAllowsMemberUpdate(runtime, data)) !== null;
          },
        },
        resolveCreateStatus: async ({ data }) => {
          const board = await boardAllowsMemberWrite(runtime, data);
          if (!board) {
            throw new NpForbiddenError(runtime.collections.posts, "create");
          }
          return board.moderation;
        },
      },
    },
    access: {
      read: () => true,
      create: async (args) => {
        if (!(await isEditorOrAbove(args))) return false;
        const boardId = args.data?.board;
        if (typeof boardId !== "string") return false;
        const board = await getForumBoardById(runtime, boardId);
        return board !== null && board.writeMode !== "closed";
      },
      update: isEditorOrAbove,
      delete: isEditorOrAbove,
    },
    hooks: {
      beforeCreate: [
        async ({ data, principal }) => {
          const boardId = data.board;
          const board =
            typeof boardId === "string"
              ? principal?.kind === "member"
                ? await findForumBoardById(runtime, boardId)
                : await getForumBoardById(runtime, boardId)
              : null;
          if (!board) {
            throw new NpValidationError("Invalid forum board", [
              { field: "board", message: "Select an active forum board." },
            ]);
          }
          if (!categoryAllowed(board, data.category)) {
            throw new NpValidationError("Invalid forum post category", [
              { field: "category", message: "Select a category configured on this board." },
            ]);
          }
          await validateForumAttachments(board, data, principal);
          return {
            ...data,
            boardKey: board.key,
            ...(!board.commentsEnabled ? { locked: true } : {}),
          };
        },
      ],
      beforeUpdate: [
        async ({ data, principal, originalDoc }) => {
          const boardId = data.board;
          const board =
            typeof boardId === "string"
              ? principal?.kind === "member"
                ? await findForumBoardById(runtime, boardId)
                : await getForumBoardById(runtime, boardId)
              : null;
          if (!board) {
            throw new NpValidationError("Invalid forum board", [
              { field: "board", message: "Select an active forum board." },
            ]);
          }
          if (!categoryAllowed(board, data.category)) {
            throw new NpValidationError("Invalid forum post category", [
              { field: "category", message: "Select a category configured on this board." },
            ]);
          }
          await validateForumAttachments(board, data, principal, originalDoc?.attachments);
          return { ...data, boardKey: board.key };
        },
      ],
    },
    seo: {
      urlPath: (doc) =>
        typeof doc.id === "string" && typeof doc.boardKey === "string"
          ? `${runtime.basePath}/${doc.boardKey}/${doc.id}`
          : null,
      changefreq: "daily",
      priority: 0.6,
    },
    fields: [
      {
        type: "relationship",
        name: "board",
        label: "Board",
        relationTo: runtime.collections.boards,
        required: true,
      },
      {
        type: "text",
        name: "boardKey",
        label: "Board key snapshot",
        hidden: true,
        maxLength: 63,
      },
      {
        type: "text",
        name: "title",
        required: true,
        minLength: 1,
        maxLength: 200,
        admin: { kind: "title", placeholder: "제목" },
      },
      {
        type: "richText",
        name: "body",
        required: true,
      },
      {
        type: "array",
        name: "attachments",
        label: "Attachments",
        maxRows: npMediaAttachmentLimits.maxFilesPerDocument,
        admin: {
          description:
            "Files shown below the post body. Member uploads must satisfy the selected board policy.",
        },
        fields: [
          {
            type: "upload",
            name: "file",
            label: "File",
            relationTo: "media",
            required: true,
          },
        ],
      },
      {
        type: "text",
        name: "category",
        maxLength: 63,
        admin: {
          position: "sidebar",
          group: "Board",
          description: "Use a category key configured on the selected board.",
        },
      },
      {
        type: "checkbox",
        name: "moderationHidden",
        required: true,
        defaultValue: false,
        hidden: true,
      },
      {
        type: "checkbox",
        name: "pinned",
        defaultValue: false,
        admin: {
          position: "sidebar",
          group: "Moderation",
          description: "Pin this post above the regular board list.",
        },
      },
      {
        type: "checkbox",
        name: "locked",
        defaultValue: false,
        admin: {
          position: "sidebar",
          group: "Moderation",
          description: "Prevent new comments while preserving existing comments.",
        },
      },
    ],
  });
}
