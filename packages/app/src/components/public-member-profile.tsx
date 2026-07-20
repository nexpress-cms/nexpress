import type { NpThemeMemberProfileProps } from "@nexpress/theme";
import Link from "next/link";

function ActivityItem({
  item,
  locale,
  commentLabel,
}: {
  item: NpThemeMemberProfileProps["activity"]["items"][number];
  locale: string;
  commentLabel: string;
}) {
  const content =
    item.kind === "document" ? (
      <>
        <span className="np-member-profile-activity-kind">{item.collectionLabel}</span>
        <strong>{item.title}</strong>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(locale)}</time>
      </>
    ) : (
      <>
        <span className="np-member-profile-activity-kind">{commentLabel}</span>
        <strong>{item.targetTitle}</strong>
        <p>{item.excerpt}</p>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(locale)}</time>
      </>
    );
  return (
    <li className="np-member-profile-activity-item" data-np-member-activity-item={item.kind}>
      {item.href ? <Link href={item.href}>{content}</Link> : <div>{content}</div>}
    </li>
  );
}

export function PublicMemberProfile({
  profile,
  activity,
  followAction,
  locale,
  links,
  labels,
}: NpThemeMemberProfileProps) {
  const empty = activity.kind === "documents" ? labels.emptyDocuments : labels.emptyComments;
  return (
    <article className="np-member-profile" data-np-member-profile={profile.handle}>
      <header className="np-member-profile-header">
        <div className="np-member-profile-identity">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" width={80} height={80} />
          ) : (
            <span className="np-member-profile-avatar-fallback" aria-hidden="true">
              {profile.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <h1>{profile.displayName}</h1>
            <p>@{profile.handle}</p>
          </div>
        </div>
        <div className="np-member-profile-follow">{followAction}</div>
      </header>

      <p className={`np-member-profile-bio${profile.bio ? "" : " is-empty"}`}>
        {profile.bio ?? labels.emptyBio}
      </p>
      <dl className="np-member-profile-stats">
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
      </dl>

      <section className="np-member-profile-activity" data-np-member-activity={activity.kind}>
        <nav className="np-member-profile-tabs" aria-label={labels.activityNavigation}>
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
          <ul className="np-member-profile-activity-list">
            {activity.items.map((item) => (
              <ActivityItem
                key={item.kind === "document" ? item.documentId : item.commentId}
                item={item}
                locale={locale}
                commentLabel={labels.comment}
              />
            ))}
          </ul>
        ) : (
          <p className="np-member-profile-activity-empty">{empty}</p>
        )}
        {links.previous || links.next ? (
          <nav className="np-member-profile-pagination" aria-label={labels.paginationNavigation}>
            {links.previous ? <Link href={links.previous}>{labels.previous}</Link> : <span />}
            <span>
              {activity.page} / {Math.max(1, activity.totalPages)}
            </span>
            {links.next ? <Link href={links.next}>{labels.next}</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </article>
  );
}
