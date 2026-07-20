import Link from "next/link";

import type {
  NpForumBoard,
  NpForumBoardIndexSkinProps,
  NpForumMessages,
  NpForumPostComposerSkinProps,
  NpForumPostDetailSkinProps,
  NpForumPostListSkinProps,
  NpForumPostSummary,
  NpForumSkin,
} from "../types.js";
import { ForumEngagementCounts } from "./engagement.js";

function boardPolicyItems(
  board: NpForumBoard,
  messages: NpForumMessages,
): Array<{ id: "attachments" | "comments" | "moderation" | "write"; label: string }> {
  const write = {
    members: messages.writeMembers,
    staff: messages.writeStaff,
    closed: messages.writeClosed,
  }[board.writeMode];
  return [
    { id: "write", label: write },
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
    ...(board.attachments.enabled
      ? [
          {
            id: "attachments" as const,
            label: `${messages.attachments} · ${board.attachments.maxFiles.toLocaleString(messages.locale)}`,
          },
        ]
      : []),
  ];
}

function BoardPolicy({
  board,
  messages,
  compact = false,
}: {
  board: NpForumBoard;
  messages: NpForumMessages;
  compact?: boolean;
}) {
  return (
    <ul
      className={`np-forum-community-policy${compact ? " np-forum-community-policy-compact" : ""}`}
      aria-label={messages.boardPolicy}
    >
      {boardPolicyItems(board, messages).map((item) => (
        <li key={item.id}>{item.label}</li>
      ))}
    </ul>
  );
}

function categoryLabel(board: NpForumBoard, key: string | null): string | null {
  if (!key) return null;
  return board.categories.find((category) => category.key === key)?.label ?? key;
}

function ForumAuthor({ post, messages }: { post: NpForumPostSummary; messages: NpForumMessages }) {
  if (!post.author) {
    return (
      <span className="np-forum-community-author">
        <span className="np-forum-community-avatar" aria-hidden="true">
          NP
        </span>
        <span className="np-forum-community-author-copy">
          <strong>{messages.staff}</strong>
        </span>
      </span>
    );
  }

  const initial = post.author.displayName.trim().slice(0, 1) || post.author.handle.slice(0, 1);
  return (
    <Link href={`/u/${post.author.handle}`} className="np-forum-community-author">
      <span className="np-forum-community-avatar" aria-hidden="true">
        {post.author.avatarUrl ? (
          <img src={post.author.avatarUrl} alt="" width="36" height="36" loading="lazy" />
        ) : (
          initial.toLocaleUpperCase(messages.locale)
        )}
      </span>
      <span className="np-forum-community-author-copy">
        <strong>{post.author.displayName}</strong>
        <small>@{post.author.handle}</small>
      </span>
    </Link>
  );
}

function PostStateBadges({
  post,
  messages,
  hideNotice = false,
}: {
  post: NpForumPostSummary;
  messages: NpForumMessages;
  hideNotice?: boolean;
}) {
  const showNotice = !hideNotice && post.pinned;
  if (!showNotice && !post.locked && post.status === "published") return null;
  return (
    <span className="np-forum-community-state">
      {showNotice ? <span className="np-forum-notice-badge">{messages.notice}</span> : null}
      {post.locked ? <span className="np-forum-state-badge">{messages.locked}</span> : null}
      {post.status !== "published" ? (
        <span className="np-forum-state-badge">{messages.pending}</span>
      ) : null}
    </span>
  );
}

function PostRow({
  basePath,
  board,
  post,
  messages,
  number,
  notice = false,
  hrefForQuery,
}: {
  basePath: string;
  board: NpForumBoard;
  post: NpForumPostSummary;
  messages: NpForumMessages;
  number?: number;
  notice?: boolean;
  hrefForQuery: NpForumPostListSkinProps["hrefForQuery"];
}) {
  const category = categoryLabel(board, post.category);
  const updated = post.updatedAt.getTime() > post.createdAt.getTime();
  return (
    <li
      className={`np-forum-community-row${notice ? " np-forum-community-row-notice" : ""}`}
      data-np-forum-pinned={post.pinned || notice ? "true" : "false"}
      data-np-forum-locked={post.locked ? "true" : "false"}
      data-np-forum-status={post.status}
    >
      <div className="np-forum-community-row-number" aria-hidden="true">
        {notice ? messages.notice : number?.toLocaleString(messages.locale)}
      </div>
      <div className="np-forum-community-row-main">
        <div className="np-forum-community-row-kicker">
          {category && post.category ? (
            <Link href={hrefForQuery({ category: post.category })}>{category}</Link>
          ) : null}
          <PostStateBadges post={post} messages={messages} hideNotice={notice} />
        </div>
        <h3>
          <Link href={`${basePath}/${board.key}/${post.id}`}>{post.title}</Link>
          {post.attachmentCount > 0 ? (
            <span
              className="np-forum-attachment-count"
              aria-label={`${messages.attachments}: ${post.attachmentCount.toLocaleString(messages.locale)}`}
            >
              📎 {post.attachmentCount.toLocaleString(messages.locale)}
            </span>
          ) : null}
        </h3>
        <div className="np-forum-community-row-mobile-meta">
          <ForumAuthor post={post} messages={messages} />
          <time dateTime={post.createdAt.toISOString()}>
            {post.createdAt.toLocaleDateString(messages.locale)}
          </time>
        </div>
        <ForumEngagementCounts post={post} messages={messages} />
      </div>
      <ForumAuthor post={post} messages={messages} />
      <div className="np-forum-community-row-dates">
        <time dateTime={post.createdAt.toISOString()}>
          <span>{messages.createdAt}</span>
          {post.createdAt.toLocaleDateString(messages.locale)}
        </time>
        {updated ? (
          <time dateTime={post.updatedAt.toISOString()}>
            <span>{messages.updatedAt}</span>
            {post.updatedAt.toLocaleDateString(messages.locale)}
          </time>
        ) : null}
      </div>
    </li>
  );
}

type PaginationItem = { type: "page"; page: number } | { type: "gap"; key: string };

function paginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  const pages = new Set([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page > 1 && page < totalPages) pages.add(page);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const items: PaginationItem[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous > 0 && page - previous > 1) {
      items.push({ type: "gap", key: `${previous.toString()}-${page.toString()}` });
    }
    items.push({ type: "page", page });
    previous = page;
  }
  return items;
}

function Pagination(props: NpForumPostListSkinProps) {
  if (props.totalPages <= 1) return null;
  return (
    <nav className="np-forum-community-pagination" aria-label={props.messages.pagination}>
      {props.query.page > 1 ? (
        <Link
          href={props.hrefForQuery({ page: props.query.page - 1 })}
          className="np-forum-community-page-direction"
        >
          ← {props.messages.previous}
        </Link>
      ) : (
        <span className="np-forum-community-page-direction" aria-hidden="true" />
      )}
      <div className="np-forum-community-page-numbers">
        {paginationItems(props.query.page, props.totalPages).map((item) =>
          item.type === "gap" ? (
            <span key={item.key} aria-hidden="true">
              …
            </span>
          ) : (
            <Link
              key={item.page}
              href={props.hrefForQuery({ page: item.page })}
              aria-current={item.page === props.query.page ? "page" : undefined}
              aria-label={props.messages.pageOf(item.page, props.totalPages)}
            >
              {item.page.toLocaleString(props.messages.locale)}
            </Link>
          ),
        )}
      </div>
      {props.query.page < props.totalPages ? (
        <Link
          href={props.hrefForQuery({ page: props.query.page + 1 })}
          className="np-forum-community-page-direction"
        >
          {props.messages.next} →
        </Link>
      ) : (
        <span className="np-forum-community-page-direction" aria-hidden="true" />
      )}
    </nav>
  );
}

function renderBoardIndex({ basePath, boards, messages }: NpForumBoardIndexSkinProps) {
  return (
    <main
      className="np-forum np-forum-community"
      data-np-forum-skin="community-full"
      data-np-forum-surface="board-index"
    >
      <header className="np-forum-community-index-header">
        <div>
          <h1>{messages.boards}</h1>
        </div>
        <p>
          <strong>{boards.length.toLocaleString(messages.locale)}</strong> {messages.boards}
        </p>
      </header>
      {boards.length === 0 ? (
        <p className="np-forum-empty">{messages.emptyBoards}</p>
      ) : (
        <ul className="np-forum-community-board-grid">
          {boards.map((board) => (
            <li key={board.id}>
              <Link href={`${basePath}/${board.key}`}>
                <div className="np-forum-community-board-heading">
                  <strong>{board.name}</strong>
                  <span aria-hidden="true">→</span>
                </div>
                {board.description ? <p>{board.description}</p> : null}
                {board.categories.length > 0 ? (
                  <div
                    className="np-forum-community-board-categories"
                    aria-label={messages.category}
                  >
                    {board.categories.slice(0, 4).map((category) => (
                      <span key={category.key}>{category.label}</span>
                    ))}
                    {board.categories.length > 4 ? (
                      <span>+{(board.categories.length - 4).toLocaleString(messages.locale)}</span>
                    ) : null}
                  </div>
                ) : null}
                <BoardPolicy board={board} messages={messages} compact />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function renderPostList(props: NpForumPostListSkinProps) {
  const { basePath, board, messages } = props;
  const hasFilters =
    props.query.search !== null || props.query.category !== null || props.query.showMine;
  const firstNumber = props.totalPosts - (props.query.page - 1) * board.pageSize;
  return (
    <main
      className="np-forum np-forum-community"
      data-np-forum-skin="community-full"
      data-np-forum-surface="post-list"
    >
      <header className="np-forum-community-hero">
        <div className="np-forum-community-hero-copy">
          <Link href={basePath} className="np-forum-back-link">
            ← {messages.boards}
          </Link>
          <h1>{board.name}</h1>
          {board.description ? <p>{board.description}</p> : null}
          <BoardPolicy board={board} messages={messages} />
        </div>
        <nav className="np-forum-community-actions" aria-label={messages.posts}>
          {props.subscriptionAction}
          <Link
            href={props.hrefForQuery({ showMine: false, page: 1 })}
            aria-current={!props.query.showMine ? "page" : undefined}
          >
            {messages.allPosts}
          </Link>
          {props.isAuthenticated ? (
            <Link
              href={props.hrefForQuery({ showMine: true, page: 1 })}
              aria-current={props.query.showMine ? "page" : undefined}
            >
              {messages.myPosts}
            </Link>
          ) : null}
          {props.canCreate ? (
            <Link href={`${basePath}/${board.key}/new`} className="np-button-primary">
              {messages.newPost}
            </Link>
          ) : !props.isAuthenticated && board.writeMode === "members" ? (
            <Link
              href={`/members/login?next=${encodeURIComponent(`${basePath}/${board.key}/new`)}`}
              className="np-button-primary"
            >
              {messages.signInToPost}
            </Link>
          ) : null}
        </nav>
      </header>

      <section className="np-forum-discovery np-forum-community-discovery">
        {board.categories.length > 0 ? (
          <nav className="np-forum-category-filter" aria-label={messages.category}>
            <Link
              href={props.hrefForQuery({ category: null, page: 1 })}
              aria-current={props.query.category === null ? "page" : undefined}
            >
              {messages.allCategories}
            </Link>
            {board.categories.map((category) => (
              <Link
                key={category.key}
                href={props.hrefForQuery({ category: category.key, page: 1 })}
                aria-current={props.query.category === category.key ? "page" : undefined}
              >
                {category.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <form
          action={`${basePath}/${board.key}`}
          method="get"
          role="search"
          className="np-forum-search"
        >
          {props.query.category ? (
            <input type="hidden" name="category" value={props.query.category} />
          ) : null}
          {props.query.showMine ? <input type="hidden" name="author" value="me" /> : null}
          <label>
            <span className="np-forum-visually-hidden">{messages.searchPosts}</span>
            <input
              type="search"
              name="q"
              defaultValue={props.query.search ?? ""}
              maxLength={props.searchMaxLength}
              placeholder={messages.searchPlaceholder}
            />
          </label>
          <button type="submit">{messages.searchPosts}</button>
          {hasFilters ? (
            <Link
              href={props.hrefForQuery({
                search: null,
                category: null,
                showMine: false,
                page: 1,
              })}
            >
              {messages.clearFilters}
            </Link>
          ) : null}
        </form>
      </section>

      {props.pinnedPosts.length > 0 ? (
        <section className="np-forum-community-notices" aria-labelledby="np-forum-notices-heading">
          <div className="np-forum-community-section-heading">
            <h2 id="np-forum-notices-heading">{messages.notice}</h2>
          </div>
          <ul>
            {props.pinnedPosts.map((post) => (
              <PostRow
                key={post.id}
                basePath={basePath}
                board={board}
                post={post}
                messages={messages}
                notice
                hrefForQuery={props.hrefForQuery}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {props.posts.length > 0 ? (
        <section className="np-forum-community-posts" aria-labelledby="np-forum-posts-heading">
          <div className="np-forum-community-section-heading">
            <h2 id="np-forum-posts-heading">
              {props.query.showMine ? messages.myPosts : messages.posts}
            </h2>
            <p>
              <strong>{props.totalPosts.toLocaleString(messages.locale)}</strong> {messages.posts}
            </p>
          </div>
          <ol>
            {props.posts.map((post, index) => (
              <PostRow
                key={post.id}
                basePath={basePath}
                board={board}
                post={post}
                messages={messages}
                number={firstNumber - index}
                hrefForQuery={props.hrefForQuery}
              />
            ))}
          </ol>
        </section>
      ) : props.pinnedPosts.length === 0 ? (
        <div className="np-forum-community-empty">
          <p className="np-forum-empty">
            {hasFilters ? messages.emptyFilteredPosts : messages.emptyPosts}
          </p>
          {hasFilters ? (
            <Link
              href={props.hrefForQuery({
                search: null,
                category: null,
                showMine: false,
                page: 1,
              })}
            >
              {messages.clearFilters}
            </Link>
          ) : null}
        </div>
      ) : null}

      <Pagination {...props} />
    </main>
  );
}

function renderPostDetail(props: NpForumPostDetailSkinProps) {
  const { basePath, board, post, messages } = props;
  const category = categoryLabel(board, post.category);
  const updated = post.updatedAt.getTime() > post.createdAt.getTime();
  return (
    <main
      className="np-forum np-forum-community"
      data-np-forum-skin="community-full"
      data-np-forum-surface="post-detail"
    >
      <article className="np-forum-community-detail">
        <header className="np-forum-community-detail-header">
          <Link href={`${basePath}/${board.key}`} className="np-forum-back-link">
            ← {messages.backToBoard}
          </Link>
          <div className="np-forum-community-detail-kicker">
            {category ? (
              <span className="np-forum-community-detail-category">{category}</span>
            ) : null}
            <PostStateBadges post={post} messages={messages} />
          </div>
          <h1>{post.title}</h1>
          <div className="np-forum-community-detail-byline">
            <ForumAuthor post={post} messages={messages} />
            <div className="np-forum-community-detail-dates">
              <time dateTime={post.createdAt.toISOString()}>
                <span>{messages.createdAt}</span>
                {post.createdAt.toLocaleString(messages.locale)}
              </time>
              {updated ? (
                <time dateTime={post.updatedAt.toISOString()}>
                  <span>{messages.updatedAt}</span>
                  {post.updatedAt.toLocaleString(messages.locale)}
                </time>
              ) : null}
            </div>
          </div>
          {props.authorActions || props.reportAction || props.subscriptionAction ? (
            <div className="np-forum-post-actions">
              {props.subscriptionAction}
              {props.authorActions}
              {props.reportAction}
            </div>
          ) : null}
        </header>
        <div className="np-forum-post-body np-forum-rich-text">{props.body}</div>
        {props.attachments.length > 0 ? (
          <section
            className="np-forum-attachments np-forum-community-attachments"
            data-np-forum-attachments="list"
          >
            <div className="np-forum-community-section-heading">
              <h2>{messages.attachments}</h2>
              <p>{props.attachments.length.toLocaleString(messages.locale)}</p>
            </div>
            <ul>
              {props.attachments.map((attachment) => (
                <li key={attachment.id} data-np-forum-attachment={attachment.id}>
                  <a href={attachment.downloadUrl} download>
                    <span>{attachment.filename}</span>
                    <small>{formatFileSize(attachment.filesize, messages.locale)}</small>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {props.engagement}
        {props.comments ? <section className="np-forum-comments">{props.comments}</section> : null}
        <footer className="np-forum-community-detail-footer">
          <Link href={`${basePath}/${board.key}`}>← {messages.backToBoard}</Link>
          <BoardPolicy board={board} messages={messages} compact />
        </footer>
      </article>
    </main>
  );
}

function formatFileSize(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes.toLocaleString(locale)} B`;
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KB`;
}

function renderPostComposer(props: NpForumPostComposerSkinProps) {
  return (
    <main
      className="np-forum np-forum-community np-forum-community-composer"
      data-np-forum-skin="community-full"
      data-np-forum-surface="composer"
      data-np-forum-composer={props.mode}
    >
      <header className="np-forum-community-composer-header">
        <div>
          <Link href={props.backHref} className="np-forum-back-link">
            ← {props.backLabel}
          </Link>
          <span className="np-forum-community-eyebrow">{props.board.name}</span>
          <h1>{props.title}</h1>
        </div>
        <BoardPolicy board={props.board} messages={props.messages} />
      </header>
      <section className="np-forum-community-composer-panel">{props.content}</section>
    </main>
  );
}

export const communityFullForumSkin: NpForumSkin = {
  id: "community-full",
  label: "Community full",
  renderBoardIndex,
  renderPostList,
  renderPostDetail,
  renderPostComposer,
};
