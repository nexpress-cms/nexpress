import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { NpAgentGuardianContentActivityV1 } from "../../agent-contract/guardian-content-contract.js";
import { npAgentEvents } from "./agent.js";
import { npSites } from "./system.js";

/** Source-only outbox. Its writer takes no Runtime, quota or document locks.
 * No document/revision FK: a historical committed fact survives their pruning.
 * Delivery state is mutable; signed source facts are not. */
export const npAgentContentReceipts = pgTable(
  "np_agent_content_receipts",
  {
    id: uuid("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    body: jsonb("body").$type<NpAgentGuardianContentActivityV1>().notNull(),
    bodyHash: text("body_hash").notNull(),
    keyId: text("key_id").notNull(),
    sourceMac: text("source_mac").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    state: text("state").notNull().default("pending"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    failureCode: text("failure_code"),
    emittedEventId: uuid("emitted_event_id"),
    emittedAt: timestamp("emitted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("np_agent_content_receipts_site_id_id_unique").on(t.siteId, t.id),
    index("np_agent_content_receipts_pending_idx")
      .on(t.siteId, t.nextAttemptAt, t.createdAt, t.id)
      .where(sql`${t.state} in ('pending','blocked')`),
    index("np_agent_content_receipts_state_idx").on(t.state, t.siteId),
    index("np_agent_content_receipts_event_idx").on(t.siteId, t.emittedEventId),
    index("np_agent_content_receipts_history_idx").on(t.siteId, t.createdAt, t.id),
    index("np_agent_content_receipts_coverage_idx")
      .on(t.siteId, t.occurredAt, t.id)
      .where(sql`${t.state}='emitted'`),
    index("np_agent_content_receipts_document_idx")
      .on(
        t.siteId,
        sql`(${t.body}->>'collection')`,
        sql`(${t.body}->>'documentId')`,
        t.occurredAt,
        t.id,
      )
      .where(sql`${t.state}='emitted'`),
    foreignKey({
      name: "np_agent_content_receipts_event_fk",
      columns: [t.siteId, t.emittedEventId],
      foreignColumns: [npAgentEvents.siteId, npAgentEvents.id],
    }).onDelete("restrict"),
    check(
      "np_agent_content_receipts_source_check",
      sql`(${t.body}->>'schemaVersion'='np.agent-guardian-content-activity.v1'
        and ${t.body}->>'siteId'=${t.siteId} and ${t.body}->>'writeId'=${t.id}::text
        and ${t.body}->>'occurredAt'=to_char(${t.occurredAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        and octet_length(${t.body}::text)<=8192
        and ${t.bodyHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$'
        and ${t.keyId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
        and ${t.sourceMac} ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$') is true`,
    ),
    check(
      "np_agent_content_receipts_delivery_check",
      sql`((${t.state}='emitted' and ${t.emittedEventId} is not null
          and ${t.emittedAt} is not null and ${t.failureCode} is null)
        or (${t.state}='pending' and ${t.emittedEventId} is null
          and ${t.emittedAt} is null and ${t.failureCode} is null)
        or (${t.state}='blocked' and ${t.emittedEventId} is null
          and ${t.emittedAt} is null
          and ${t.failureCode} in ('KEY_UNAVAILABLE','SOURCE_INTEGRITY','DELIVERY_UNAVAILABLE'))
        or (${t.state}='sampled' and ${t.emittedEventId} is null
          and ${t.emittedAt} is null and ${t.failureCode}='COVERAGE_CAPPED')
        or (${t.state}='held' and ${t.emittedEventId} is null
          and ${t.emittedAt} is null and ${t.failureCode}='DELIVERY_CLOSED')) is true`,
    ),
  ],
);
