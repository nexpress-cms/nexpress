import Link from "next/link";

import type {
  NpForumBoardIndexSkinProps,
  NpForumPostComposerSkinProps,
  NpForumPostDetailSkinProps,
  NpForumPostListSkinProps,
  NpForumPostSummary,
  NpForumSkin,
} from "../types.js";
import { ForumEngagementCounts } from "./engagement.js";

function author(post: NpForumPostSummary, staffLabel: string) {
  return post.author ? (
    <Link href={`/u/${post.author.handle}`} className="np-forum-author">
      @{post.author.handle}
    </Link>
  ) : (
    <span className="np-forum-author">{staffLabel}</span>
  );
}

function PostRows({
  basePath,
  boardKey,
  posts,
  firstNumber,
  notice,
  messages,
  categoryLabels,
}: {
  basePath: string;
  boardKey: string;
  posts: NpForumPostSummary[];
  firstNumber: number;
  notice: boolean;
  messages: NpForumPostListSkinProps["messages"];
  categoryLabels: ReadonlyMap<string, string>;
}) {
  return posts.map((post, index) => (
    <tr key={post.id} className={notice ? "np-forum-row-notice" : undefined}>
      <td className="np-forum-column-number">
        {notice ? (
          <span className="np-forum-notice-badge">{messages.notice}</span>
        ) : (
          firstNumber - index
        )}
      </td>
      <td className="np-forum-column-category">
        {post.category ? (categoryLabels.get(post.category) ?? post.category) : "—"}
      </td>
      <td className="np-forum-column-title">
        <Link href={`${basePath}/${boardKey}/${post.id}`}>{post.title}</Link>
        {post.locked ? <span className="np-forum-state-badge">{messages.locked}</span> : null}
        {post.status !== "published" ? (
          <span className="np-forum-state-badge">{messages.pending}</span>
        ) : null}
        <ForumEngagementCounts
          post={post}
          messages={messages}
          className="np-forum-row-engagement"
        />
      </td>
      <td>{author(post, messages.staff)}</td>
      <td className="np-forum-column-views">
        {post.engagement.viewCount.toLocaleString(messages.locale)}
      </td>
      <td className="np-forum-column-reactions">
        {post.engagement.reactionCount.toLocaleString(messages.locale)}
      </td>
      <td className="np-forum-column-date">
        <time dateTime={post.createdAt.toISOString()}>
          {post.createdAt.toLocaleDateString(messages.locale)}
        </time>
      </td>
    </tr>
  ));
}

function renderBoardIndex({ basePath, boards, messages }: NpForumBoardIndexSkinProps) {
  return (
    <main
      className="np-forum np-forum-classic"
      data-np-forum-skin="classic"
      data-np-forum-surface="board-index"
    >
      <header className="np-forum-page-header">
        <h1>{messages.boards}</h1>
      </header>
      {boards.length === 0 ? (
        <p className="np-forum-empty">{messages.emptyBoards}</p>
      ) : (
        <ul className="np-forum-board-grid">
          {boards.map((board) => (
            <li key={board.id}>
              <Link href={`${basePath}/${board.key}`}>
                <strong>{board.name}</strong>
                {board.description ? <span>{board.description}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function renderPostList(props: NpForumPostListSkinProps) {
  const { basePath, board, posts, pinnedPosts, messages } = props;
  const hasFilters =
    props.query.search !== null || props.query.category !== null || props.query.showMine;
  const categoryLabels = new Map(
    board.categories.map((category) => [category.key, category.label] as const),
  );
  return (
    <main
      className="np-forum np-forum-classic"
      data-np-forum-skin="classic"
      data-np-forum-surface="post-list"
    >
      <header className="np-forum-page-header">
        <div>
          <Link href={basePath} className="np-forum-back-link">
            {messages.boards}
          </Link>
          <h1>{board.name}</h1>
          {board.description ? <p>{board.description}</p> : null}
        </div>
        <nav className="np-forum-toolbar" aria-label={messages.posts}>
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

      <div className="np-forum-discovery">
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
      </div>

      {posts.length === 0 && pinnedPosts.length === 0 ? (
        <p className="np-forum-empty">
          {hasFilters ? messages.emptyFilteredPosts : messages.emptyPosts}
        </p>
      ) : (
        <div className="np-forum-table-wrap">
          <table className="np-forum-table">
            <thead>
              <tr>
                <th scope="col" className="np-forum-column-number">
                  {messages.number}
                </th>
                <th scope="col" className="np-forum-column-category">
                  {messages.category}
                </th>
                <th scope="col" className="np-forum-column-title">
                  {messages.title}
                </th>
                <th scope="col">{messages.author}</th>
                <th scope="col" className="np-forum-column-views">
                  {messages.views}
                </th>
                <th scope="col" className="np-forum-column-reactions">
                  {messages.reactions}
                </th>
                <th scope="col" className="np-forum-column-date">
                  {messages.date}
                </th>
              </tr>
            </thead>
            <tbody>
              <PostRows
                basePath={basePath}
                boardKey={board.key}
                posts={pinnedPosts}
                firstNumber={pinnedPosts.length}
                notice
                messages={messages}
                categoryLabels={categoryLabels}
              />
              <PostRows
                basePath={basePath}
                boardKey={board.key}
                posts={posts}
                firstNumber={props.totalPosts - (props.query.page - 1) * board.pageSize}
                notice={false}
                messages={messages}
                categoryLabels={categoryLabels}
              />
            </tbody>
          </table>
        </div>
      )}

      {props.totalPages > 1 ? (
        <nav className="np-forum-pagination" aria-label={messages.pagination}>
          {props.query.page > 1 ? (
            <Link href={props.hrefForQuery({ page: props.query.page - 1 })}>
              {messages.previous}
            </Link>
          ) : (
            <span />
          )}
          <span>{messages.pageOf(props.query.page, props.totalPages)}</span>
          {props.query.page < props.totalPages ? (
            <Link href={props.hrefForQuery({ page: props.query.page + 1 })}>{messages.next}</Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}

function renderPostDetail(props: NpForumPostDetailSkinProps) {
  const { basePath, board, post, messages } = props;
  return (
    <main
      className="np-forum np-forum-classic"
      data-np-forum-skin="classic"
      data-np-forum-surface="post-detail"
    >
      <article className="np-forum-post">
        <header className="np-forum-post-header">
          <Link href={`${basePath}/${board.key}`} className="np-forum-back-link">
            ← {messages.backToBoard}
          </Link>
          <div className="np-forum-post-kicker">
            {post.category ? (
              <span>
                {board.categories.find((category) => category.key === post.category)?.label ??
                  post.category}
              </span>
            ) : null}
            {post.pinned ? <span className="np-forum-notice-badge">{messages.notice}</span> : null}
            {post.locked ? <span className="np-forum-state-badge">{messages.locked}</span> : null}
          </div>
          <h1>{post.title}</h1>
          <div className="np-forum-post-meta">
            {author(post, messages.staff)}
            <time dateTime={post.createdAt.toISOString()}>
              {post.createdAt.toLocaleString(messages.locale)}
            </time>
          </div>
          {props.authorActions}
        </header>
        <div className="np-forum-post-body np-forum-rich-text">{props.body}</div>
        {props.engagement}
        <section className="np-forum-comments">{props.comments}</section>
      </article>
    </main>
  );
}

function renderPostComposer(props: NpForumPostComposerSkinProps) {
  return (
    <main
      className="np-forum np-forum-classic np-forum-member-page"
      data-np-forum-skin="classic"
      data-np-forum-surface="composer"
      data-np-forum-composer={props.mode}
    >
      <header className="np-forum-page-header">
        <div>
          <Link href={props.backHref} className="np-forum-back-link">
            ← {props.backLabel}
          </Link>
          <h1>{props.title}</h1>
        </div>
      </header>
      {props.content}
    </main>
  );
}

export const classicForumSkin: NpForumSkin = {
  id: "classic",
  label: "Classic board",
  renderBoardIndex,
  renderPostList,
  renderPostDetail,
  renderPostComposer,
};
