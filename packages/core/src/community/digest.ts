import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { npMembers, npNotifications } from "../db/schema/community.js";
import { sendEmail } from "../email/service.js";
import { getLogger } from "../observability/logger.js";
import { listSites, NP_DEFAULT_SITE_ID } from "../sites/registry.js";

import { type NpDigestCadence, recordDigestSent } from "./notification-prefs.js";

/**
 * Phase 16.4 — email digest fan-out. The `notifications:sendDigest`
 * recurring job calls `runDigestSweep(cadence)` on a daily and a
 * weekly schedule; the function fetches every active member who
 * opted into that cadence, builds an inbox summary scoped to "since
 * last digest" (falling back to the cadence window when the member
 * has never received one), renders an email through the configured
 * `NpEmailAdapter`, and stamps `lastDigestAt` on success.
 *
 * The job is idempotent enough for production use: a sweep that
 * runs twice for the same window won't re-email members because
 * `lastDigestAt` advances on the first send. Failures inside the
 * loop are logged-and-continued — one stuck member doesn't block
 * the rest of the sweep.
 */

export interface NpDigestNotificationSummary {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface NpDigestEmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface BuildDigestEmailInput {
  member: { displayName: string; handle: string };
  notifications: NpDigestNotificationSummary[];
  cadence: NpDigestCadence;
  /** Site display name; defaults to "your site" so the noop adapter is still readable. */
  siteName?: string;
}

const LABELS: Record<string, string> = {
  "comment.reply": "New reply on your comment",
  "comment.received": "New comment on your content",
  "comment.mention": "You were mentioned in a comment",
  "document.mention": "You were mentioned in a discussion",
  "reaction.received": "Someone reacted to your content",
  "follow.received": "Someone followed you",
  "follow.activity": "New activity on followed content",
};

function labelFor(kind: string): string {
  return LABELS[kind] ?? `Notification (${kind})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Pure renderer; exposed so plugins / tests can call it without
 * the DB read path.
 */
export function buildDigestEmail(input: BuildDigestEmailInput): NpDigestEmailContent {
  const site = input.siteName ?? "your site";
  const cadenceWord = input.cadence === "weekly" ? "weekly" : "daily";
  const total = input.notifications.length;
  const subject =
    total === 1
      ? `Your ${cadenceWord} digest from ${site}: 1 notification`
      : `Your ${cadenceWord} digest from ${site}: ${total} notifications`;

  const lines = input.notifications.map((n) => {
    const label = labelFor(n.kind);
    const when = n.createdAt.toISOString();
    const href = typeof n.payload.href === "string" ? ` — ${n.payload.href}` : "";
    return `- ${label} (${when})${href}`;
  });
  const text = [
    `Hi @${input.member.handle},`,
    "",
    `You have ${total} unread notification${total === 1 ? "" : "s"} from the last ${cadenceWord} window:`,
    "",
    ...lines,
    "",
    `Manage your digest settings: /members/me/notifications`,
  ].join("\n");

  const items = input.notifications
    .map((n) => {
      const label = escapeHtml(labelFor(n.kind));
      const when = escapeHtml(n.createdAt.toISOString());
      const href = typeof n.payload.href === "string" ? escapeHtml(n.payload.href) : null;
      return `<li><strong>${label}</strong> <span style="color:#64748b">— ${when}</span>${href ? ` <code>${href}</code>` : ""}</li>`;
    })
    .join("");
  const html = [
    `<p>Hi @${escapeHtml(input.member.handle)},</p>`,
    `<p>You have ${total} unread notification${total === 1 ? "" : "s"} from the last ${cadenceWord} window:</p>`,
    `<ul>${items}</ul>`,
    `<p style="color:#64748b;font-size:0.9rem">`,
    `Manage your digest settings at `,
    `<a href="/members/me/notifications">/members/me/notifications</a>.`,
    `</p>`,
  ].join("");

  return { subject, text, html };
}

interface MemberDigestRow {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  prefs: Record<string, unknown>;
}

function fallbackWindow(cadence: NpDigestCadence, now: Date): Date {
  const ms = cadence === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

/**
 * Pulls every active member whose `notification_prefs.digest`
 * matches `cadence`. The JSONB filter uses Postgres `->>`
 * extraction; the `digest` field is a small string, indexes are
 * unnecessary at v1 scale.
 */
async function listMembersForCadence(
  db: NodePgDatabase<Record<string, unknown>>,
  cadence: Exclude<NpDigestCadence, "off">,
): Promise<MemberDigestRow[]> {
  const rows = (await db
    .select({
      id: npMembers.id,
      email: npMembers.email,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
      prefs: npMembers.notificationPrefs,
      status: npMembers.status,
    })
    .from(npMembers)
    .where(
      and(
        eq(npMembers.status, "active"),
        sql`${npMembers.notificationPrefs} ->> 'digest' = ${cadence}`,
      ),
    )) as Array<MemberDigestRow & { status: string }>;
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    handle: r.handle,
    displayName: r.displayName,
    prefs: r.prefs,
  }));
}

async function fetchUnreadSince(
  db: NodePgDatabase<Record<string, unknown>>,
  memberId: string,
  siteId: string,
  since: Date,
): Promise<NpDigestNotificationSummary[]> {
  const rows = (await db
    .select({
      id: npNotifications.id,
      kind: npNotifications.kind,
      payload: npNotifications.payload,
      createdAt: npNotifications.createdAt,
    })
    .from(npNotifications)
    .where(
      and(
        eq(npNotifications.memberId, memberId),
        // Issue #218 — scope to the site we're sweeping. Without
        // this the digest mixed inboxes across tenants and the
        // recipient saw notifications from sites they don't even
        // know exist.
        eq(npNotifications.siteId, siteId),
        // Unread + within the window. If the member already read
        // everything in the inbox the digest would be noise, so we
        // skip silently (caller increments `skipped` when the list
        // comes back empty).
        gt(npNotifications.createdAt, since),
        isNull(npNotifications.readAt),
      ),
    )
    .orderBy(desc(npNotifications.createdAt))
    .limit(50)) as NpDigestNotificationSummary[];
  return rows;
}

export interface RunDigestSweepInput {
  cadence: "daily" | "weekly";
  /** Defaults to `new Date()`. Tests override for determinism. */
  now?: Date;
  /** Site name woven into subject + body. Defaults to `"your site"`. */
  siteName?: string;
}

export interface RunDigestSweepResult {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function runDigestSweep(input: RunDigestSweepInput): Promise<RunDigestSweepResult> {
  const now = input.now ?? new Date();
  const db = getDb();
  const log = getLogger();

  // Issue #218 — fan-out per site. The previous implementation
  // ran a single sweep that mixed every tenant's inbox into one
  // digest and stamped one global `lastDigestAt`; advancing it
  // for tenant A would suppress tenant B's next digest entirely.
  // We now iterate the site registry and run an independent
  // sweep per (site, member) — same email cadence, but each
  // recipient gets one email per site they have unread
  // notifications on.
  const sites = await listSites();
  const candidateSites = sites.length > 0 ? sites : [{ id: NP_DEFAULT_SITE_ID, name: "" }];
  const members = await listMembersForCadence(db, input.cadence);

  let considered = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const site of candidateSites) {
    for (const member of members) {
      considered += 1;
      const since = lastDigestSinceFor(member, site.id, input.cadence, now);

      const notifications = await fetchUnreadSince(db, member.id, site.id, since);
      if (notifications.length === 0) {
        skipped += 1;
        continue;
      }

      const email = buildDigestEmail({
        member: { displayName: member.displayName, handle: member.handle },
        notifications,
        cadence: input.cadence,
        // Caller-supplied `siteName` is an explicit override
        // (single-tenant deploys, tests pinning a friendly
        // brand name); the per-site `name` is the natural
        // multi-tenant default.
        siteName:
          input.siteName && input.siteName.length > 0
            ? input.siteName
            : typeof site.name === "string" && site.name.length > 0
              ? site.name
              : undefined,
      });

      try {
        await sendEmail({
          to: member.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        await recordDigestSent(member.id, now, { siteId: site.id, cadence: input.cadence });
        sent += 1;
      } catch (err) {
        failed += 1;
        log.warn("digest send failed", {
          memberId: member.id,
          siteId: site.id,
          cadence: input.cadence,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { considered, sent, skipped, failed };
}

/**
 * Issue #218 — pick the right "since" cutoff for one (site,
 * member, cadence) sweep. Reads precedence:
 *   1. `lastDigestAtBySite[siteId][cadence]` — the per-site
 *      timestamp the new sweep writes after each successful send.
 *   2. legacy `lastDigestAt` — single-tenant deploys without
 *      site-scoped writes still keep their existing window.
 *   3. fallback window (24h / 7d) — a member who has never
 *      received any digest.
 */
function lastDigestSinceFor(
  member: MemberDigestRow,
  siteId: string,
  cadence: NpDigestCadence,
  now: Date,
): Date {
  const prefs = member.prefs ?? {};
  const bySite = prefs.lastDigestAtBySite as
    Record<string, Partial<Record<string, string>>> | undefined;
  const perSite = bySite?.[siteId]?.[cadence];
  if (typeof perSite === "string") {
    const parsed = new Date(perSite);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  if (typeof prefs.lastDigestAt === "string") {
    const parsed = new Date(prefs.lastDigestAt);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return fallbackWindow(cadence, now);
}
