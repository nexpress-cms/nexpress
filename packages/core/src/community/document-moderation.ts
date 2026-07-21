import { getCollectionConfig } from "../collections/registry.js";
import {
  npApplyMemberThreadModeration,
  type NpApplyMemberThreadModerationInput,
} from "../collections/pipeline.js";
import type { CommunityCapability, NpThreadModerationAction } from "../community-contract/types.js";

import { memberCapabilities, type MemberAction } from "./can.js";
import {
  npIsMemberModeratableDocument,
  npResolveDocumentCommunityTarget,
} from "./target-scopes.js";

export interface NpDocumentModerationPermissions {
  viewStaffTools: boolean;
  editThread: boolean;
  deleteThread: boolean;
  editComments: boolean;
  deleteComments: boolean;
  hideComments: boolean;
  restoreComments: boolean;
  resolveReports: boolean;
  actions: NpThreadModerationAction[];
}

const permissionActions = [
  "view-staff-tools",
  "edit-any-thread",
  "delete-any-thread",
  "edit-own-thread",
  "delete-own",
  "lock-thread",
  "unlock-thread",
  "lock-own-thread",
  "pin-thread",
  "unpin-thread",
  "hide-thread",
  "restore-thread",
  "edit-any-comment",
  "delete-any-comment",
  "hide-comment",
  "restore-comment",
  "resolve-report",
] as const satisfies readonly MemberAction[];

function has(allowed: ReadonlySet<MemberAction>, action: CommunityCapability | "delete-own") {
  return allowed.has(action);
}

/** Resolve one bounded permission snapshot for a document detail/list surface. */
export async function getDocumentModerationPermissions(
  memberId: string,
  collection: string,
  documentId: string,
): Promise<NpDocumentModerationPermissions> {
  const target = await npResolveDocumentCommunityTarget(collection, documentId);
  const config = getCollectionConfig(collection);
  const moderation = config.community?.moderation;
  const moderatable = npIsMemberModeratableDocument(config, target.document);
  const allowed = await memberCapabilities(memberId, permissionActions, {
    type: "thread",
    id: documentId,
    ownerId: target.ownerId ?? undefined,
    scopes: target.scopes,
  });
  const actions: NpThreadModerationAction[] = [];
  if (moderation && moderatable) {
    const status = target.document.status;
    if (status === "published" && has(allowed, "hide-thread")) actions.push("hide");
    if (
      status === "pending" &&
      has(allowed, "restore-thread") &&
      (target.document[moderation.hiddenField] === true || target.ownerId !== null)
    ) {
      actions.push("restore");
    }
    if (moderation.lockField) {
      const locked = target.document[moderation.lockField] === true;
      if (!locked && (has(allowed, "lock-thread") || has(allowed, "lock-own-thread"))) {
        actions.push("lock");
      }
      if (locked && (has(allowed, "unlock-thread") || has(allowed, "lock-own-thread"))) {
        actions.push("unlock");
      }
    }
    if (moderation.pinField) {
      const pinned = target.document[moderation.pinField] === true;
      if (!pinned && has(allowed, "pin-thread")) actions.push("pin");
      if (pinned && has(allowed, "unpin-thread")) actions.push("unpin");
    }
  }
  return {
    viewStaffTools: has(allowed, "view-staff-tools"),
    editThread:
      moderation !== undefined &&
      moderatable &&
      config.community?.memberWrite?.update === true &&
      (has(allowed, "edit-own-thread") || has(allowed, "edit-any-thread")),
    deleteThread:
      moderation !== undefined &&
      moderatable &&
      config.community?.memberWrite?.delete === true &&
      (has(allowed, "delete-own") || has(allowed, "delete-any-thread")),
    editComments: has(allowed, "edit-any-comment"),
    deleteComments: has(allowed, "delete-any-comment"),
    hideComments: has(allowed, "hide-comment"),
    restoreComments: has(allowed, "restore-comment"),
    resolveReports: has(allowed, "resolve-report"),
    actions,
  };
}

export async function moderateMemberThread(input: NpApplyMemberThreadModerationInput) {
  return npApplyMemberThreadModeration(input);
}
