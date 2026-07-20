import type { NpForumMessages, NpForumPostSummary } from "../types.js";

export function ForumEngagementCounts({
  post,
  messages,
  className = "np-forum-engagement-counts",
}: {
  post: NpForumPostSummary;
  messages: NpForumMessages;
  className?: string;
}) {
  return (
    <span className={className} data-np-forum-engagement="summary">
      <span data-np-forum-metric="views">
        {messages.views} {post.engagement.viewCount.toLocaleString(messages.locale)}
      </span>
      <span data-np-forum-metric="comments">
        {messages.commentsCount} {post.engagement.commentCount.toLocaleString(messages.locale)}
      </span>
      <span data-np-forum-metric="reactions">
        {messages.reactions} {post.engagement.reactionCount.toLocaleString(messages.locale)}
      </span>
    </span>
  );
}
