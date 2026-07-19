import Link from "next/link";

import type {
  NpForumBoardIndexSkinProps,
  NpForumPostDetailSkinProps,
  NpForumPostListSkinProps,
  NpForumPostSummary,
  NpForumSkin,
} from "../types.js";

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
      </td>
      <td>{author(post, messages.staff)}</td>
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
    <main className="np-forum np-forum-classic" data-np-forum-skin="classic">
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
  const categoryLabels = new Map(
    board.categories.map((category) => [category.key, category.label] as const),
  );
  return (
    <main className="np-forum np-forum-classic" data-np-forum-skin="classic">
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
            href={`${basePath}/${board.key}`}
            aria-current={!props.showMine ? "page" : undefined}
          >
            {messages.allPosts}
          </Link>
          {props.isAuthenticated ? (
            <Link
              href={`${basePath}/${board.key}?author=me`}
              aria-current={props.showMine ? "page" : undefined}
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

      {posts.length === 0 && pinnedPosts.length === 0 ? (
        <p className="np-forum-empty">{messages.emptyPosts}</p>
      ) : (
        <div className="np-forum-table-wrap">
          <table className="np-forum-table">
            <thead>
              <tr>
                <th>{messages.number}</th>
                <th>{messages.category}</th>
                <th>{messages.title}</th>
                <th>{messages.author}</th>
                <th>{messages.date}</th>
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
                firstNumber={props.totalPosts - (props.page - 1) * board.pageSize}
                notice={false}
                messages={messages}
                categoryLabels={categoryLabels}
              />
            </tbody>
          </table>
        </div>
      )}

      {props.totalPages > 1 ? (
        <nav className="np-forum-pagination" aria-label="Pagination">
          {props.page > 1 ? (
            <Link href={props.hrefForPage(props.page - 1)}>{messages.previous}</Link>
          ) : (
            <span />
          )}
          <span>{messages.pageOf(props.page, props.totalPages)}</span>
          {props.page < props.totalPages ? (
            <Link href={props.hrefForPage(props.page + 1)}>{messages.next}</Link>
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
    <main className="np-forum np-forum-classic" data-np-forum-skin="classic">
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
        <div className="np-forum-post-body prose">{props.body}</div>
        <section className="np-forum-comments">{props.comments}</section>
      </article>
    </main>
  );
}

export const classicForumSkin: NpForumSkin = {
  id: "classic",
  label: "Classic board",
  renderBoardIndex,
  renderPostList,
  renderPostDetail,
};
