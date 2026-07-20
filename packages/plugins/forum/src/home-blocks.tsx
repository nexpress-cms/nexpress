import Link from "next/link";

import type { NpBlockDefinition, NpPatternDefinition } from "@nexpress/plugin-sdk";

import {
  enrichForumPosts,
  getForumHomeMessages,
  npForumBoardKeyPattern,
  normalizeForumBoard,
  type ForumBoardDocument,
  type ForumHomeMessages,
  type ForumPostDocument,
  type NpForumRuntime,
} from "./runtime.js";
import type { NpForumBoard, NpForumMessages, NpForumPostSummary } from "./types.js";
import { ForumEngagementCounts } from "./skins/engagement.js";

const MAX_FEED_LIMIT = 20;
const MAX_FEED_SCAN = 200;

type ForumFeedMode = "latest" | "notices" | "popular";
type ForumFeedLayout = "list" | "cards";
type ForumDirectoryColumns = "auto" | "two" | "three" | "four";
type ForumBlockRenderContext = NonNullable<Parameters<NpBlockDefinition["render"]>[2]>;

interface ForumFeedItem {
  board: NpForumBoard;
  post: NpForumPostSummary;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readLimit(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function readBoardKey(value: unknown): string | null {
  const key = readString(value, "");
  if (key.length === 0) return null;
  if (!npForumBoardKeyPattern.test(key)) {
    throw new Error("Forum home block board key is invalid.");
  }
  return key;
}

function readFeedMode(value: unknown): ForumFeedMode {
  return value === "notices" || value === "popular" ? value : "latest";
}

function readWindowDays(value: unknown): number {
  return readLimit(value, 7, 90);
}

export function npForumPopularityScore(post: NpForumPostSummary): number {
  return (
    post.engagement.viewCount + post.engagement.commentCount * 4 + post.engagement.reactionCount * 6
  );
}

function readFeedLayout(value: unknown): ForumFeedLayout {
  return value === "cards" ? "cards" : "list";
}

function readDirectoryColumns(value: unknown): ForumDirectoryColumns {
  return value === "two" || value === "three" || value === "four" ? value : "auto";
}

function policyLabels(board: NpForumBoard, messages: NpForumMessages) {
  return [
    {
      id: "write",
      label: {
        members: messages.writeMembers,
        staff: messages.writeStaff,
        closed: messages.writeClosed,
      }[board.writeMode],
    },
    {
      id: "moderation",
      label:
        board.moderation === "published"
          ? messages.moderationPublished
          : messages.moderationPending,
    },
    {
      id: "comments",
      label: board.commentsEnabled ? messages.commentsOpen : messages.commentsClosed,
    },
  ];
}

function categoryLabel(board: NpForumBoard, category: string | null): string | null {
  if (!category) return null;
  return board.categories.find((entry) => entry.key === category)?.label ?? category;
}

async function listForumBoardsForBlock(
  runtime: NpForumRuntime,
  ctx: ForumBlockRenderContext,
): Promise<NpForumBoard[]> {
  const result = await ctx.content.find(runtime.collections.boards, {
    where: { status: "published" },
    sort: "name",
    page: 1,
    limit: 100,
  });
  return result.docs.map((document) => normalizeForumBoard(document as ForumBoardDocument));
}

async function findForumBoardByKeyForBlock(
  runtime: NpForumRuntime,
  key: string,
  ctx: ForumBlockRenderContext,
): Promise<NpForumBoard | null> {
  const result = await ctx.content.find(runtime.collections.boards, {
    where: { slug: key, status: "published" },
    page: 1,
    limit: 1,
  });
  const board = result.docs[0];
  return board ? normalizeForumBoard(board as ForumBoardDocument) : null;
}

async function listForumFeed(
  runtime: NpForumRuntime,
  ctx: ForumBlockRenderContext,
  {
    mode,
    boardKey,
    limit,
    windowDays,
  }: {
    mode: ForumFeedMode;
    boardKey: string | null;
    limit: number;
    windowDays: number;
  },
): Promise<ForumFeedItem[]> {
  const selectedBoard = boardKey ? await findForumBoardByKeyForBlock(runtime, boardKey, ctx) : null;
  if (boardKey && !selectedBoard) return [];

  const boards = selectedBoard ? [selectedBoard] : await listForumBoardsForBlock(runtime, ctx);
  if (boards.length === 0) return [];
  const boardsById = new Map(boards.map((board) => [board.id, board] as const));
  const where: Record<string, unknown> = {
    status: "published",
    pinned: mode === "notices",
  };
  if (selectedBoard) where.board = selectedBoard.id;

  const scanLimit =
    mode === "popular"
      ? MAX_FEED_SCAN
      : selectedBoard
        ? limit
        : Math.min(MAX_FEED_SCAN, Math.max(50, limit * 4));
  const result = await ctx.content.find(runtime.collections.posts, {
    where,
    sort: "-createdAt",
    page: 1,
    limit: scanLimit,
  });
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const activeDocuments = (result.docs as ForumPostDocument[]).filter((document) => {
    const board = boardsById.get(document.board);
    return (
      board !== undefined &&
      document.boardKey === board.key &&
      (mode !== "popular" || document.createdAt.getTime() >= cutoff)
    );
  });
  const posts = await enrichForumPosts(activeDocuments, runtime.collections.posts);
  const orderedPosts =
    mode === "popular"
      ? posts
          .sort(
            (left, right) =>
              npForumPopularityScore(right) - npForumPopularityScore(left) ||
              right.createdAt.getTime() - left.createdAt.getTime() ||
              left.id.localeCompare(right.id),
          )
          .slice(0, limit)
      : posts.slice(0, limit);
  const documentsById = new Map(activeDocuments.map((document) => [document.id, document]));
  return orderedPosts.flatMap((post) => {
    const document = documentsById.get(post.id);
    const board = document ? boardsById.get(document.board) : undefined;
    return board ? [{ board, post }] : [];
  });
}

function ForumBlockHeading({
  heading,
  href,
  messages,
}: {
  heading: string;
  href: string;
  messages: ForumHomeMessages;
}) {
  return (
    <header className="np-forum-block-heading">
      {heading.length > 0 ? <h2>{heading}</h2> : null}
      <Link href={href}>{messages.viewAll}</Link>
    </header>
  );
}

async function ForumBoardDirectoryBody({
  runtime,
  ctx,
  heading,
  limit,
  columns,
  showDescriptions,
  showCategories,
  showPolicies,
}: {
  runtime: NpForumRuntime;
  ctx: ForumBlockRenderContext;
  heading: string;
  limit: number;
  columns: ForumDirectoryColumns;
  showDescriptions: boolean;
  showCategories: boolean;
  showPolicies: boolean;
}) {
  const [allBoards, messages] = await Promise.all([
    listForumBoardsForBlock(runtime, ctx),
    getForumHomeMessages(),
  ]);
  const boards = allBoards.slice(0, limit);
  return (
    <section
      className="np-forum-block np-forum-board-directory-block"
      data-np-forum-block="board-directory"
      data-np-forum-columns={columns}
    >
      <ForumBlockHeading heading={heading} href={runtime.basePath} messages={messages} />
      {boards.length === 0 ? (
        <p className="np-forum-block-empty">{messages.emptyBoards}</p>
      ) : (
        <ul className="np-forum-block-board-list">
          {boards.map((board) => (
            <li
              key={board.id}
              data-np-forum-write-mode={board.writeMode}
              data-np-forum-moderation={board.moderation}
              data-np-forum-comments={board.commentsEnabled ? "open" : "closed"}
            >
              <Link href={`${runtime.basePath}/${board.key}`} className="np-forum-block-board-link">
                <span className="np-forum-block-board-name">{board.name}</span>
                {showDescriptions && board.description ? <p>{board.description}</p> : null}
                {showCategories && board.categories.length > 0 ? (
                  <span className="np-forum-block-board-categories">
                    {board.categories.slice(0, 4).map((category) => (
                      <span key={category.key}>{category.label}</span>
                    ))}
                  </span>
                ) : null}
                {showPolicies ? (
                  <span className="np-forum-block-board-policy" aria-label={messages.boardPolicy}>
                    {policyLabels(board, messages).map((item) => (
                      <span key={item.id}>{item.label}</span>
                    ))}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedAuthor({ post, messages }: { post: NpForumPostSummary; messages: NpForumMessages }) {
  return post.author ? (
    <Link href={`/u/${post.author.handle}`} className="np-forum-block-feed-author">
      {post.author.displayName}
    </Link>
  ) : (
    <span className="np-forum-block-feed-author">{messages.staff}</span>
  );
}

async function ForumPostFeedBody({
  runtime,
  ctx,
  heading,
  mode,
  boardKey,
  limit,
  layout,
  showBoard,
  showCategory,
  showAuthor,
  showDate,
  showEngagement,
  windowDays,
}: {
  runtime: NpForumRuntime;
  ctx: ForumBlockRenderContext;
  heading: string;
  mode: ForumFeedMode;
  boardKey: string | null;
  limit: number;
  layout: ForumFeedLayout;
  showBoard: boolean;
  showCategory: boolean;
  showAuthor: boolean;
  showDate: boolean;
  showEngagement: boolean;
  windowDays: number;
}) {
  const [items, messages] = await Promise.all([
    listForumFeed(runtime, ctx, { mode, boardKey, limit, windowDays }),
    getForumHomeMessages(),
  ]);
  const feedHref = boardKey ? `${runtime.basePath}/${boardKey}` : runtime.basePath;
  return (
    <section
      className="np-forum-block np-forum-post-feed-block"
      data-np-forum-block="post-feed"
      data-np-forum-feed-mode={mode}
      data-np-forum-feed-layout={layout}
      data-np-forum-board={boardKey ?? "all"}
    >
      <ForumBlockHeading heading={heading} href={feedHref} messages={messages} />
      {items.length === 0 ? (
        <p className="np-forum-block-empty">
          {mode === "notices" ? messages.emptyNotices : messages.emptyPosts}
        </p>
      ) : (
        <ol className="np-forum-block-feed-list">
          {items.map(({ board, post }) => {
            const category = categoryLabel(board, post.category);
            return (
              <li
                key={post.id}
                data-np-forum-pinned={post.pinned ? "true" : "false"}
                data-np-forum-locked={post.locked ? "true" : "false"}
              >
                <div className="np-forum-block-feed-kicker">
                  {mode === "notices" ? (
                    <span className="np-forum-notice-badge">{messages.notice}</span>
                  ) : null}
                  {showBoard ? (
                    <Link href={`${runtime.basePath}/${board.key}`}>{board.name}</Link>
                  ) : null}
                  {showCategory && category ? <span>{category}</span> : null}
                  {post.locked ? <span>{messages.locked}</span> : null}
                </div>
                <h3>
                  <Link href={`${runtime.basePath}/${board.key}/${post.id}`}>{post.title}</Link>
                </h3>
                {showAuthor || showDate ? (
                  <div className="np-forum-block-feed-meta">
                    {showAuthor ? <FeedAuthor post={post} messages={messages} /> : null}
                    {showDate ? (
                      <time dateTime={post.createdAt.toISOString()}>
                        {post.createdAt.toLocaleDateString(messages.locale)}
                      </time>
                    ) : null}
                  </div>
                ) : null}
                {showEngagement ? <ForumEngagementCounts post={post} messages={messages} /> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function createForumHomeBlocks(runtime: NpForumRuntime): NpBlockDefinition[] {
  return [
    {
      type: "forum.board-directory",
      label: "Forum board directory",
      description: "Lists active public forum boards using the forum's configured collection.",
      icon: "🗂️",
      category: "content",
      keywords: ["forum", "community", "boards", "directory"],
      summaryFields: ["heading", "limit", "columns"],
      defaultProps: {
        heading: "Community boards",
        limit: 12,
        columns: "auto",
        showDescriptions: true,
        showCategories: true,
        showPolicies: true,
      },
      propsSchema: [
        {
          name: "heading",
          label: "Heading",
          type: "text",
          translatable: true,
          defaultValue: "Community boards",
          group: "Content",
        },
        {
          name: "limit",
          label: "Maximum boards",
          type: "number",
          min: 1,
          max: 100,
          step: 1,
          defaultValue: 12,
          group: "Content",
        },
        {
          name: "columns",
          label: "Columns",
          type: "select",
          defaultValue: "auto",
          options: [
            { label: "Automatic", value: "auto" },
            { label: "Two", value: "two" },
            { label: "Three", value: "three" },
            { label: "Four", value: "four" },
          ],
          group: "Layout",
        },
        {
          name: "showDescriptions",
          label: "Show descriptions",
          type: "boolean",
          defaultValue: true,
          group: "Display",
        },
        {
          name: "showCategories",
          label: "Show categories",
          type: "boolean",
          defaultValue: true,
          group: "Display",
        },
        {
          name: "showPolicies",
          label: "Show board policies",
          type: "boolean",
          defaultValue: true,
          group: "Display",
        },
      ],
      render: (props, _children, ctx) => {
        if (!ctx) throw new Error("Forum board directory requires a block render context.");
        return ForumBoardDirectoryBody({
          runtime,
          ctx,
          heading: readString(props.heading, "Community boards"),
          limit: readLimit(props.limit, 12, 100),
          columns: readDirectoryColumns(props.columns),
          showDescriptions: readBoolean(props.showDescriptions, true),
          showCategories: readBoolean(props.showCategories, true),
          showPolicies: readBoolean(props.showPolicies, true),
        });
      },
    },
    {
      type: "forum.post-feed",
      label: "Forum post feed",
      description:
        "Shows latest, notice, or bounded-window popular discussions from active public forum boards.",
      icon: "💬",
      category: "content",
      keywords: ["forum", "community", "posts", "notices", "latest", "popular"],
      summaryFields: ["heading", "mode", "boardKey", "limit"],
      defaultProps: {
        heading: "Latest discussions",
        mode: "latest",
        boardKey: "",
        limit: 8,
        layout: "list",
        showBoard: true,
        showCategory: true,
        showAuthor: true,
        showDate: true,
        showEngagement: true,
        windowDays: 7,
      },
      propsSchema: [
        {
          name: "heading",
          label: "Heading",
          type: "text",
          translatable: true,
          defaultValue: "Latest discussions",
          group: "Content",
        },
        {
          name: "mode",
          label: "Feed",
          type: "select",
          defaultValue: "latest",
          options: [
            { label: "Latest discussions", value: "latest" },
            { label: "Notices", value: "notices" },
            { label: "Popular discussions", value: "popular" },
          ],
          group: "Content",
        },
        {
          name: "boardKey",
          label: "Board key",
          type: "text",
          translatable: false,
          defaultValue: "",
          placeholder: "Leave empty for all boards",
          pattern: "(?:|[a-z][a-z0-9-]{1,62})",
          validationMessage: "Use a lowercase forum board key, or leave this empty.",
          description: "Optional public board key. Unknown boards render an empty feed.",
          group: "Content",
        },
        {
          name: "limit",
          label: "Maximum posts",
          type: "number",
          min: 1,
          max: MAX_FEED_LIMIT,
          step: 1,
          defaultValue: 8,
          group: "Content",
        },
        {
          name: "windowDays",
          label: "Popularity window (days)",
          type: "number",
          min: 1,
          max: 90,
          step: 1,
          defaultValue: 7,
          visibleWhen: [["mode", "popular"]],
          group: "Content",
        },
        {
          name: "layout",
          label: "Layout",
          type: "select",
          defaultValue: "list",
          options: [
            { label: "List", value: "list" },
            { label: "Cards", value: "cards" },
          ],
          group: "Layout",
        },
        {
          name: "showBoard",
          label: "Show board",
          type: "boolean",
          defaultValue: true,
          group: "Display",
        },
        {
          name: "showCategory",
          label: "Show category",
          type: "boolean",
          defaultValue: true,
          group: "Display",
        },
        {
          name: "showAuthor",
          label: "Show author",
          type: "boolean",
          defaultValue: true,
          group: "Display",
        },
        {
          name: "showEngagement",
          label: "Show view, comment, and reaction counts",
          type: "boolean",
          defaultValue: true,
          group: "Display",
        },
        {
          name: "showDate",
          label: "Show date",
          type: "boolean",
          defaultValue: true,
          group: "Display",
        },
      ],
      render: (props, _children, ctx) => {
        const boardKey = readBoardKey(props.boardKey);
        if (!ctx) throw new Error("Forum post feed requires a block render context.");
        return ForumPostFeedBody({
          runtime,
          ctx,
          heading: readString(props.heading, "Latest discussions"),
          mode: readFeedMode(props.mode),
          boardKey,
          limit: readLimit(props.limit, 8, MAX_FEED_LIMIT),
          layout: readFeedLayout(props.layout),
          showBoard: readBoolean(props.showBoard, true),
          showCategory: readBoolean(props.showCategory, true),
          showAuthor: readBoolean(props.showAuthor, true),
          showDate: readBoolean(props.showDate, true),
          showEngagement: readBoolean(props.showEngagement, true),
          windowDays: readWindowDays(props.windowDays),
        });
      },
    },
  ];
}

export const forumHomePatterns = [
  {
    id: "forum.community-home",
    label: "Community home",
    description:
      "A board directory, notices, popular discussions, and latest posts using the active forum configuration.",
    category: "homepage",
    blocks: [
      {
        id: "forum-home-boards",
        type: "forum.board-directory",
        props: {
          heading: "Community boards",
          limit: 12,
          columns: "auto",
          showDescriptions: true,
          showCategories: true,
          showPolicies: true,
        },
      },
      {
        id: "forum-home-notices",
        type: "forum.post-feed",
        props: {
          heading: "Notices",
          mode: "notices",
          boardKey: "",
          limit: 5,
          layout: "list",
          showBoard: true,
          showCategory: false,
          showAuthor: false,
          showDate: true,
        },
      },
      {
        id: "forum-home-popular",
        type: "forum.post-feed",
        props: {
          heading: "Popular discussions",
          mode: "popular",
          boardKey: "",
          limit: 6,
          windowDays: 7,
          layout: "cards",
          showBoard: true,
          showCategory: true,
          showAuthor: false,
          showDate: false,
          showEngagement: true,
        },
      },
      {
        id: "forum-home-latest",
        type: "forum.post-feed",
        props: {
          heading: "Latest discussions",
          mode: "latest",
          boardKey: "",
          limit: 10,
          layout: "cards",
          showBoard: true,
          showCategory: true,
          showAuthor: true,
          showDate: true,
          showEngagement: true,
        },
      },
    ],
  },
] satisfies NpPatternDefinition[];
