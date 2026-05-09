import { listNotificationKinds, getMemberNotificationPrefs } from "@nexpress/core";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getSiteMember } from "@/lib/site-member";
import { NotificationPrefsForm } from "@/components/notification-prefs-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notification settings",
  robots: { index: false, follow: false },
};

/**
 * Phase 16.3 — member-side notification toggle page. The server
 * component pre-fetches prefs + the kind catalog so the form
 * doesn't flash an empty state before the API resolves.
 * Anonymous viewers redirect to login with a `next` param so
 * sign-in lands back here.
 */
export default async function NotificationSettingsPage() {
  const member = await getSiteMember();
  if (!member) {
    redirect("/members/login?next=/members/me/notifications");
  }
  const [prefs, kinds] = await Promise.all([
    getMemberNotificationPrefs(member.id),
    Promise.resolve(listNotificationKinds()),
  ]);
  return (
    <section style={{ maxWidth: 640, margin: "2.5rem auto", padding: "0 1.25rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Notification settings</h1>
      <p style={{ color: "#64748b", marginBottom: "1.5rem" }}>
        Choose which notification kinds land in your inbox. Disabling a kind silently drops new
        notifications of that kind &mdash; existing ones stay readable.
      </p>
      <NotificationPrefsForm initialPrefs={prefs} kinds={kinds} />
    </section>
  );
}
