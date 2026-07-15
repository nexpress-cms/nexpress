import {
  getMemberNotificationPrefs,
  listNotificationKinds,
  listNotifications,
} from "@nexpress/core/community";
import { npToNotificationWireRow } from "@nexpress/core/community-contract";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getSiteMember } from "@nexpress/next";
import { NotificationPrefsForm } from "../../../components/notification-prefs-form";
import {
  NotificationsInbox,
  type NotificationInboxItem,
} from "../../../components/notifications-inbox";
import { ShellWrap } from "../../../components/shell-wrap";
import { ensureFor } from "../../../lib/init-core";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

/**
 * Member-side notification hub. The server component pre-fetches the
 * inbox, unread count, prefs, and kind catalog so the page renders
 * useful content before the client-side mark-read controls hydrate.
 */
export default async function NotificationsPage() {
  await ensureFor("read");
  const member = await getSiteMember();
  if (!member) {
    redirect("/members/login?next=/members/me/notifications");
  }
  const kinds = listNotificationKinds();
  const [prefs, inbox] = await Promise.all([
    getMemberNotificationPrefs(member.id),
    listNotifications(member.id, { limit: 50, offset: 0 }),
  ]);
  return (
    <ShellWrap surface="member">
      <section
        style={{
          maxWidth: 760,
          margin: "2.5rem auto",
          padding: "0 1.25rem",
          display: "grid",
          gap: "2rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.25rem" }}>Notifications</h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            Review unread activity and tune which notification kinds land in your inbox.
          </p>
        </div>

        <NotificationsInbox
          initialNotifications={inbox.notifications.map(toClientNotification)}
          initialUnread={inbox.unread}
          totalDocs={inbox.totalDocs}
        />

        <section style={{ display: "grid", gap: "1rem" }} aria-labelledby="notification-settings">
          <div>
            <h2 id="notification-settings" style={{ fontSize: "1.15rem", margin: 0 }}>
              Settings
            </h2>
            <p style={{ color: "#64748b", margin: "0.25rem 0 0" }}>
              Disabling a kind silently drops new notifications of that kind. Existing notifications
              stay readable.
            </p>
          </div>
          <NotificationPrefsForm initialPrefs={prefs} kinds={kinds} />
        </section>
      </section>
    </ShellWrap>
  );
}

function toClientNotification(
  row: Parameters<typeof npToNotificationWireRow>[0],
): NotificationInboxItem {
  return npToNotificationWireRow(row);
}
