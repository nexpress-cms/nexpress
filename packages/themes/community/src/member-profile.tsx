import type { NpThemeMemberProfileProps } from "@nexpress/theme";
import Link from "next/link";

export function CommunityMemberProfile({
  profile,
  activity,
  followAction,
  locale,
  links,
  labels,
}: NpThemeMemberProfileProps) {
  return (
    <article
      className="np-community-member-profile"
      data-np-community-member-profile={profile.handle}
      data-np-member-profile={profile.handle}
    >
      <header className="np-community-member-profile-hero">
        <div className="np-community-member-profile-identity">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" width={96} height={96} />
          ) : (
            <span className="np-community-member-profile-avatar" aria-hidden="true">
              {profile.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="np-community-member-profile-copy">
            <p className="np-community-member-profile-eyebrow">{labels.member}</p>
            <h1>{profile.displayName}</h1>
            <p className="np-community-member-profile-handle">@{profile.handle}</p>
          </div>
        </div>
        <div className="np-community-member-profile-follow">{followAction}</div>
      </header>

      <div className="np-community-member-profile-grid">
        <aside className="np-community-member-profile-summary">
          {profile.bio ? <p>{profile.bio}</p> : <p className="is-empty">{labels.emptyBio}</p>}
          <dl>
            <div>
              <dt>{labels.memberSince}</dt>
              <dd>
                <time dateTime={profile.joinedAt}>
                  {new Date(profile.joinedAt).toLocaleDateString(locale)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{labels.reputation}</dt>
              <dd>{profile.reputation.toLocaleString(locale)}</dd>
            </div>
            <div>
              <dt>{activity.kind === "documents" ? labels.documents : labels.comments}</dt>
              <dd>{activity.totalDocs.toLocaleString(locale)}</dd>
            </div>
          </dl>
        </aside>

        <section
          className="np-community-member-profile-activity"
          data-np-member-activity={activity.kind}
        >
          <nav className="np-community-member-profile-tabs" aria-label={labels.activityNavigation}>
            <Link
              href={links.documents}
              aria-current={activity.kind === "documents" ? "page" : undefined}
            >
              {labels.documents}
            </Link>
            <Link
              href={links.comments}
              aria-current={activity.kind === "comments" ? "page" : undefined}
            >
              {labels.comments}
            </Link>
          </nav>

          {activity.items.length > 0 ? (
            <ol className="np-community-member-profile-list">
              {activity.items.map((item) => {
                const body =
                  item.kind === "document" ? (
                    <>
                      <span className="np-community-member-profile-kind">
                        {item.collectionLabel}
                      </span>
                      <strong>{item.title}</strong>
                      <time dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleDateString(locale)}
                      </time>
                    </>
                  ) : (
                    <>
                      <span className="np-community-member-profile-kind">{labels.comment}</span>
                      <strong>{item.targetTitle}</strong>
                      <p>{item.excerpt}</p>
                      <time dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleDateString(locale)}
                      </time>
                    </>
                  );
                return (
                  <li
                    key={item.kind === "document" ? item.documentId : item.commentId}
                    data-np-member-activity-item={item.kind}
                  >
                    {item.href ? <Link href={item.href}>{body}</Link> : <div>{body}</div>}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="np-community-member-profile-empty">
              {activity.kind === "documents" ? labels.emptyDocuments : labels.emptyComments}
            </p>
          )}

          {links.previous || links.next ? (
            <nav
              className="np-community-member-profile-pagination"
              aria-label={labels.paginationNavigation}
            >
              {links.previous ? <Link href={links.previous}>{labels.previous}</Link> : <span />}
              <span>
                {activity.page} / {Math.max(1, activity.totalPages)}
              </span>
              {links.next ? <Link href={links.next}>{labels.next}</Link> : <span />}
            </nav>
          ) : null}
        </section>
      </div>
    </article>
  );
}
