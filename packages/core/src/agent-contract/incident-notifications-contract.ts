import {
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodyAscii,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
export type NpAgentIncidentNotificationTransitionV1 =
  "opened" | "investigating" | "resolved" | "dismissed" | "containment_failed" | "escalated";
export interface NpAgentIncidentNotificationItemV1 {
  notificationId: string;
  incidentId: string;
  incidentVersion: number;
  transition: NpAgentIncidentNotificationTransitionV1;
  severity: "medium" | "high" | "critical";
  status: "open" | "investigating" | "contained" | "monitoring" | "resolved" | "dismissed";
  summary: string;
  adminPath: string;
  createdAt: string;
}
export interface NpAgentIncidentNotificationsV1 {
  schemaVersion: "np.agent-incident-notifications.v1";
  items: NpAgentIncidentNotificationItemV1[];
  nextCursor: string | null;
}
/** Exact observed-transition metadata. No current status, totals or inaccessible identifiers. */
export function npRequireAgentIncidentNotificationsV1(
  value: unknown,
): NpAgentIncidentNotificationsV1 {
  const bad = (): never =>
    failCanonicalBody("invalid-field", "incident.notifications", "Invalid notification projection");
  const record = (v: unknown, keys: string[]) =>
    canonicalBodyRecord(v, "incident.notifications", keys, keys, { seen: new WeakSet<object>() });
  const r = record(cloneCanonicalRuntimeInput(value, "incident.notifications", 65536), [
    "schemaVersion",
    "items",
    "nextCursor",
  ]);
  if (
    r.schemaVersion !== "np.agent-incident-notifications.v1" ||
    !Array.isArray(r.items) ||
    r.items.length > 20
  )
    bad();
  const ids = new Set<string>();
  const items = (r.items as unknown[]).map((value): NpAgentIncidentNotificationItemV1 => {
    const x = record(value, [
      "notificationId",
      "incidentId",
      "incidentVersion",
      "transition",
      "severity",
      "status",
      "summary",
      "adminPath",
      "createdAt",
    ]);
    const notificationId = canonicalBodyUuid(x.notificationId, "notification.id");
    if (ids.has(notificationId)) bad();
    ids.add(notificationId);
    const incidentId = canonicalBodyUuid(x.incidentId, "notification.incidentId");
    const transition = canonicalBodyEnum<NpAgentIncidentNotificationTransitionV1>(
      x.transition,
      "notification.transition",
      new Set([
        "opened",
        "investigating",
        "resolved",
        "dismissed",
        "containment_failed",
        "escalated",
      ]),
    );
    const severity = canonicalBodyEnum<NpAgentIncidentNotificationItemV1["severity"]>(
      x.severity,
      "notification.severity",
      new Set(["medium", "high", "critical"]),
    );
    const status =
      transition === "containment_failed" || transition === "escalated"
        ? canonicalBodyEnum<NpAgentIncidentNotificationItemV1["status"]>(
            x.status,
            "notification.status",
            new Set(["open", "investigating", "contained", "monitoring", "resolved", "dismissed"]),
          )
        : transition === "opened"
          ? "open"
          : transition;
    const summary =
      transition === "containment_failed"
        ? "Incident containment failed."
        : transition === "escalated"
          ? "Incident severity escalated."
          : `Incident ${transition}.`;
    const adminPath = `/admin/agents/incidents/${incidentId}`;
    if (
      (transition === "escalated" && ["resolved", "dismissed"].includes(status)) ||
      x.status !== status ||
      x.summary !== summary ||
      x.adminPath !== adminPath ||
      (severity === "medium" && !["opened", "escalated"].includes(transition)) ||
      (severity === "high" &&
        !["opened", "resolved", "containment_failed", "escalated"].includes(transition))
    )
      bad();
    return {
      notificationId,
      incidentId,
      incidentVersion: canonicalBodyInteger(
        x.incidentVersion,
        "notification.version",
        1,
        2147483647,
      ),
      transition,
      severity,
      status,
      summary,
      adminPath,
      createdAt: canonicalBodyUtc(x.createdAt, "notification.createdAt"),
    };
  });
  return {
    schemaVersion: "np.agent-incident-notifications.v1",
    items,
    nextCursor:
      r.nextCursor === null ? null : canonicalBodyAscii(r.nextCursor, "notification.cursor", 2048),
  };
}
