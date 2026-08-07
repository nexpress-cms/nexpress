import { createHmac, timingSafeEqual } from "node:crypto";

import {
  NP_DEFAULT_SITE_ID,
  NpValidationError,
  findDocuments,
  getCurrentSiteId,
} from "@nexpress/core";
import Link from "next/link";

import {
  enrichForumPosts,
  findForumBoardByKey,
  getForumMessages,
  normalizeForumBoard,
  npRequireForumQuestionContextHref,
  npResolveForumQuestionContextTargets,
  type ForumBoardDocument,
  type ForumPostDocument,
  type NpForumRuntime,
} from "./runtime.js";
import type { NpForumContextualQuestionsAdapter, NpForumQuestionContextSource } from "./types.js";

const CONTEXT_TYPE = /^[a-z][a-z0-9-]{1,62}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOKEN_TTL_MS = 60 * 60 * 1_000;
const MAX_TOKEN_LENGTH = 2_048;

interface QuestionContextTokenPayload {
  version: 1;
  siteId: string;
  boardId: string;
  boardKey: string;
  contextType: string;
  contextId: string;
  contextLabel: string;
  contextHref: string;
  expiresAt: number;
}

export interface NpForumQuestionSubmissionContext {
  type: string;
  id: string;
  label: string;
  href: string;
  proof: string;
}

export interface NpForumContextualQuestionInspection {
  boardState: "missing" | "draft" | "restricted" | "closed" | "ready";
  sampled: number;
  total: number;
  waiting: number;
  answered: number;
  unavailableTargets: number;
  sampleBoundReached: boolean;
}

function requireSecret(): string {
  const secret = process.env.NP_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("Forum contextual questions require NP_SECRET with at least 32 characters.");
  }
  return secret;
}

export function npRequireForumQuestionContextSource(value: unknown): NpForumQuestionContextSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Forum question context sources require a canonical type and resolve method.");
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.type !== "string" ||
    !CONTEXT_TYPE.test(raw.type) ||
    typeof raw.resolve !== "function"
  ) {
    throw new Error("Forum question context sources require a canonical type and resolve method.");
  }
  return value as unknown as NpForumQuestionContextSource;
}

async function resolveTarget(
  runtime: NpForumRuntime,
  type: string,
  id: string,
): Promise<{ id: string; label: string; href: string } | null> {
  const source = runtime.contextualQuestions?.sources.get(type);
  if (!source || !UUID.test(id)) return null;
  const targets = await npResolveForumQuestionContextTargets(source, [id]);
  return targets.get(id) ?? null;
}

function encode(payload: QuestionContextTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", requireSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function decodePart(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
}

function requirePayload(value: unknown): QuestionContextTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Forum question context proof payload is invalid.");
  }
  const raw = value as Record<string, unknown>;
  const expected = [
    "version",
    "siteId",
    "boardId",
    "boardKey",
    "contextType",
    "contextId",
    "contextLabel",
    "contextHref",
    "expiresAt",
  ];
  if (
    Object.keys(raw).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(raw, key)) ||
    raw.version !== 1 ||
    typeof raw.siteId !== "string" ||
    typeof raw.boardId !== "string" ||
    !UUID.test(raw.boardId) ||
    typeof raw.boardKey !== "string" ||
    typeof raw.contextType !== "string" ||
    !CONTEXT_TYPE.test(raw.contextType) ||
    typeof raw.contextId !== "string" ||
    !UUID.test(raw.contextId) ||
    typeof raw.contextLabel !== "string" ||
    raw.contextLabel.trim().length < 1 ||
    raw.contextLabel.trim().length > 160 ||
    !Number.isSafeInteger(raw.expiresAt)
  ) {
    throw new Error("Forum question context proof payload is invalid.");
  }
  return {
    version: 1,
    siteId: raw.siteId,
    boardId: raw.boardId,
    boardKey: raw.boardKey,
    contextType: raw.contextType,
    contextId: raw.contextId,
    contextLabel: raw.contextLabel.trim(),
    contextHref: npRequireForumQuestionContextHref(raw.contextHref),
    expiresAt: raw.expiresAt as number,
  };
}

export async function npCreateForumQuestionContextProof(
  runtime: NpForumRuntime,
  board: { id: string; key: string },
  contextType: string,
  contextId: string,
): Promise<NpForumQuestionSubmissionContext | null> {
  const target = await resolveTarget(runtime, contextType, contextId);
  if (!target) return null;
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const payload: QuestionContextTokenPayload = {
    version: 1,
    siteId,
    boardId: board.id,
    boardKey: board.key,
    contextType,
    contextId,
    contextLabel: target.label,
    contextHref: target.href,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  return {
    type: contextType,
    id: contextId,
    label: target.label,
    href: target.href,
    proof: encode(payload),
  };
}

export async function npVerifyForumQuestionContextProof(
  runtime: NpForumRuntime,
  proof: unknown,
): Promise<QuestionContextTokenPayload> {
  if (typeof proof !== "string" || proof.length < 20 || proof.length > MAX_TOKEN_LENGTH) {
    throw new Error("Forum question context proof is invalid.");
  }
  const [body, signature, extra] = proof.split(".");
  if (!body || !signature || extra !== undefined) {
    throw new Error("Forum question context proof is invalid.");
  }
  const expected = createHmac("sha256", requireSecret()).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    throw new Error("Forum question context proof is invalid.");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Forum question context proof signature is invalid.");
  }
  const payload = requirePayload(decodePart(body));
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  if (payload.siteId !== siteId || payload.expiresAt <= Date.now()) {
    throw new Error("Forum question context proof is expired or belongs to another site.");
  }
  const target = await resolveTarget(runtime, payload.contextType, payload.contextId);
  if (!target || target.label !== payload.contextLabel || target.href !== payload.contextHref) {
    throw new Error("Forum question context target is unavailable or changed.");
  }
  return payload;
}

export async function npValidateForumQuestionContextCreate(
  runtime: NpForumRuntime,
  data: Readonly<Record<string, unknown>>,
  options: { allowUnsignedSnapshot?: boolean } = {},
): Promise<Record<string, unknown>> {
  const values = [
    data.contextType,
    data.contextId,
    data.contextLabel,
    data.contextHref,
    data.contextProof,
  ];
  if (values.every((value) => value === undefined || value === null || value === "")) return {};
  try {
    if (
      options.allowUnsignedSnapshot === true &&
      (data.contextProof === undefined || data.contextProof === null || data.contextProof === "")
    ) {
      if (
        typeof data.contextType !== "string" ||
        !CONTEXT_TYPE.test(data.contextType) ||
        typeof data.contextId !== "string" ||
        !UUID.test(data.contextId) ||
        typeof data.contextLabel !== "string" ||
        data.contextLabel.trim().length < 1 ||
        data.contextLabel.trim().length > 160
      ) {
        throw new Error("Forum question context snapshot is invalid.");
      }
      return {
        contextType: data.contextType,
        contextId: data.contextId,
        contextLabel: data.contextLabel.trim(),
        contextHref: npRequireForumQuestionContextHref(data.contextHref),
        contextProof: null,
      };
    }
    const payload = await npVerifyForumQuestionContextProof(runtime, data.contextProof);
    if (
      data.board !== payload.boardId ||
      data.contextType !== payload.contextType ||
      data.contextId !== payload.contextId ||
      data.contextLabel !== payload.contextLabel ||
      data.contextHref !== payload.contextHref
    ) {
      throw new Error("Forum question context fields do not match their proof.");
    }
    return {
      contextType: payload.contextType,
      contextId: payload.contextId,
      contextLabel: payload.contextLabel,
      contextHref: payload.contextHref,
      contextProof: null,
    };
  } catch (error) {
    throw new NpValidationError("Invalid forum question context", [
      {
        field: "contextProof",
        message: error instanceof Error ? error.message : "Question context is invalid.",
      },
    ]);
  }
}

export async function npReadForumQuestionSubmissionContext(
  runtime: NpForumRuntime,
  board: { id: string; key: string },
  proof: unknown,
): Promise<NpForumQuestionSubmissionContext | null> {
  if (proof === undefined || proof === null || proof === "") return null;
  try {
    const payload = await npVerifyForumQuestionContextProof(runtime, proof);
    if (payload.boardId !== board.id || payload.boardKey !== board.key) return null;
    return {
      type: payload.contextType,
      id: payload.contextId,
      label: payload.contextLabel,
      href: payload.contextHref,
      proof: proof as string,
    };
  } catch {
    return null;
  }
}

/** Bounded, PII-free staff diagnostic shared by Admin and plugin operations. */
export async function npInspectForumContextualQuestions(
  runtime: NpForumRuntime,
): Promise<NpForumContextualQuestionInspection> {
  const configuration = runtime.contextualQuestions;
  if (!configuration) {
    return {
      boardState: "missing",
      sampled: 0,
      total: 0,
      waiting: 0,
      answered: 0,
      unavailableTargets: 0,
      sampleBoundReached: false,
    };
  }
  requireSecret();
  const boardResult = await findDocuments<ForumBoardDocument>(runtime.collections.boards, {
    where: { slug: configuration.boardKey, visibility: "*" },
    page: 1,
    limit: 1,
  });
  const board = boardResult.docs[0];
  if (board) normalizeForumBoard(board);
  const boardState = !board
    ? "missing"
    : board.status !== "published"
      ? "draft"
      : board.visibility !== "public" || board.audience === "private"
        ? "restricted"
        : board.writeMode !== "members"
          ? "closed"
          : "ready";
  if (!board) {
    return {
      boardState,
      sampled: 0,
      total: 0,
      waiting: 0,
      answered: 0,
      unavailableTargets: 0,
      sampleBoundReached: false,
    };
  }
  const result = await findDocuments<ForumPostDocument>(runtime.collections.posts, {
    where: {
      board: board.id,
      visibility: "*",
    },
    sort: "-updatedAt",
    page: 1,
    limit: 100,
  });
  const contextDocuments = result.docs.filter(
    (document) => typeof document.contextType === "string",
  );
  const liveIds = new Set<string>();
  for (const [type, source] of configuration.sources) {
    const ids = [
      ...new Set(
        contextDocuments
          .filter((document) => document.contextType === type)
          .map((document) => document.contextId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const targets = await npResolveForumQuestionContextTargets(source, ids);
    for (const id of targets.keys()) {
      liveIds.add(`${type}:${id}`);
    }
  }
  const answered = contextDocuments.filter(
    (document) => document.answeredAt instanceof Date,
  ).length;
  return {
    boardState,
    sampled: contextDocuments.length,
    total: result.totalDocs,
    waiting: contextDocuments.length - answered,
    answered,
    unavailableTargets: contextDocuments.filter(
      (document) =>
        typeof document.contextType !== "string" ||
        typeof document.contextId !== "string" ||
        !liveIds.has(`${document.contextType}:${document.contextId}`),
    ).length,
    sampleBoundReached: result.totalDocs > result.docs.length,
  };
}

export function createForumContextualQuestionsAdapter(
  runtime: NpForumRuntime,
): NpForumContextualQuestionsAdapter | null {
  if (!runtime.contextualQuestions) return null;
  return {
    id: "forum-contextual-questions",
    async renderContextQuestions({ contextType, contextId, memberId }) {
      const board = await findForumBoardByKey(
        runtime,
        runtime.contextualQuestions?.boardKey ?? "",
        memberId,
      );
      if (!board || board.writeMode !== "members") return null;
      let proof: NpForumQuestionSubmissionContext | null;
      try {
        proof = await npCreateForumQuestionContextProof(runtime, board, contextType, contextId);
      } catch {
        // Optional integration failures must not take down the host product
        // page. Admin Health evaluates the source without this containment.
        return null;
      }
      if (!proof) return null;
      const empty = { docs: [] as ForumPostDocument[], totalDocs: 0 };
      const [publicResult, privateResult, pendingOwnerResult, messages] = await Promise.all([
        findDocuments<ForumPostDocument>(runtime.collections.posts, {
          where: {
            board: board.id,
            contextType,
            contextId,
            status: "published",
            audience: memberId ? ["public", "members"] : "public",
          },
          sort: "-createdAt",
          page: 1,
          limit: 10,
        }),
        memberId
          ? findDocuments<ForumPostDocument>(runtime.collections.posts, {
              where: {
                board: board.id,
                contextType,
                contextId,
                status: "published",
                audience: "private",
                memberAuthorId: memberId,
              },
              sort: "-createdAt",
              page: 1,
              limit: 10,
            })
          : empty,
        memberId
          ? findDocuments<ForumPostDocument>(runtime.collections.posts, {
              where: {
                board: board.id,
                contextType,
                contextId,
                status: "pending",
                memberAuthorId: memberId,
                visibility: "*",
              },
              sort: "-createdAt",
              page: 1,
              limit: 10,
            })
          : empty,
        getForumMessages(),
      ]);
      const documents = [...publicResult.docs, ...privateResult.docs, ...pendingOwnerResult.docs]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, 10);
      const questions = await enrichForumPosts(documents, runtime);
      const composerHref = `${runtime.basePath}/${board.key}/new?context=${encodeURIComponent(proof.proof)}`;
      return (
        <section
          className="np-forum-context-questions"
          data-np-forum-context-questions={contextType}
        >
          <header>
            <div>
              <h2>{messages.questionHeading}</h2>
              <p>{proof.label}</p>
            </div>
            <Link className="np-button-primary" href={composerHref}>
              {messages.questionAsk}
            </Link>
          </header>
          {questions.length === 0 ? (
            <p>{messages.questionEmpty}</p>
          ) : (
            <ul>
              {questions.map((question) => (
                <li key={question.id} data-np-forum-question={question.questionStatus ?? "waiting"}>
                  <Link href={`${runtime.basePath}/${board.key}/${question.id}`}>
                    <strong>{question.title}</strong>
                    <span>
                      {question.status === "pending" ? `${messages.pending} · ` : ""}
                      {question.audience === "private" ? `${messages.questionPrivate} · ` : ""}
                      {question.questionStatus === "answered"
                        ? messages.questionAnswered
                        : messages.questionWaiting}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {publicResult.totalDocs + privateResult.totalDocs + pendingOwnerResult.totalDocs >
          questions.length ? (
            <Link href={`${runtime.basePath}/${board.key}`}>{messages.allPosts}</Link>
          ) : null}
        </section>
      );
    },
  };
}
