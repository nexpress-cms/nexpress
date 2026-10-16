import { npNotificationTimelineFingerprintV1 } from "../../../packages/core/src/agent/notification-delivery-evidence.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npDigestAgentNotificationDeliveryCanonical,
  npRequireAgentNotificationDeliveryCanonical,
} from "../../../packages/core/src/agent-contract/canonical-notification-policy.js";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentNotifications,
  npAgentSiteDeletionSagas,
} from "../../../packages/core/src/db/schema/agent.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import { deleteSite, getSiteById } from "../../../packages/core/src/sites/registry.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { notificationDeliveryFixture } from "./agent-notification-delivery-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("external notification site deletion fence", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("rolls a blocked cascade back without creating a saga and permits deletion only after the outcome is known", async () => {
    const f = await notificationDeliveryFixture({
      siteId: "notification-delete",
      idempotency: "none",
    });
    try {
      const snapshot = await f.connections.notificationDelivery.prepare({
        siteId: f.siteId,
        connectionId: f.connectionId,
      });
      const incidentId = randomUUID();
      await f.db.insert(npAgentIncidents).values({
        id: incidentId,
        siteId: f.siteId,
        category: "availability",
        severity: "high",
        status: "open",
        fingerprint: `notification-delete:${incidentId}`,
        title: "Synthetic notification deletion case",
        summary: "No transport is called.",
        firstObservedAt: new Date(),
        lastObservedAt: new Date(),
      });
      const [document] = await f.db
        .insert(postsTable)
        .values({
          siteId: f.siteId,
          title: "Cascade rollback witness",
          slug: "notification-delete-witness",
          content: {
            root: {
              children: [],
              direction: null,
              format: "",
              indent: 0,
              type: "root",
              version: 1,
            },
          },
        })
        .returning({ id: postsTable.id });
      if (!document) throw new Error("Deletion rollback witness was not created");
      const id = randomUUID();
      const deduplicationKey = `notification-delete:${id}`;
      const payloadRedacted = { incidentId, severity: "high" };
      await f.db.insert(npAgentNotifications).values({
        id,
        siteId: f.siteId,
        channel: "email",
        connectionId: snapshot.connectionId,
        connectionConfigSnapshotId: snapshot.configSnapshotId,
        adapterId: snapshot.adapterId,
        adapterFingerprint: snapshot.adapterFingerprint,
        adapterContractVersion: snapshot.adapterContractVersion,
        connectionConfigVersion: snapshot.configVersion,
        connectionConfigHash: snapshot.configHash,
        accountSubjectKeyId: snapshot.accountSubjectKeyId,
        accountSubjectDigest: snapshot.accountSubjectDigest,
        destinationKeyId: snapshot.destinationKeyId,
        destinationDescriptor: snapshot.destinationDescriptor,
        destinationFingerprint: snapshot.destinationFingerprint,
        adapterIdempotency: "none",
        incidentId,
        transitionVersion: 1,
        deduplicationKey,
        payloadRedacted,
        state: "queued",
      });
      const blocked = async () => {
        await expect(deleteSite(f.siteId, { cascade: true })).rejects.toThrow(
          "Agent site deletion requires terminal known notification deliveries.",
        );
        expect(await getSiteById(f.siteId)).not.toBeNull();
        expect(
          await f.db.select().from(postsTable).where(eq(postsTable.id, document.id)),
        ).toHaveLength(1);
        expect(
          await f.db
            .select()
            .from(npAgentSiteDeletionSagas)
            .where(eq(npAgentSiteDeletionSagas.siteId, f.siteId)),
        ).toEqual([]);
        // A refused legacy delete creates no marker that could prevent normal convergence.
        await npWithAgentRuntimeControlTransactionV1(f.siteId, () => Promise.resolve());
      };
      await blocked();
      await f.db
        .update(npAgentNotifications)
        .set({ state: "sending", attempts: 1 })
        .where(eq(npAgentNotifications.id, id));
      await blocked();
      const resultBody = (result: {
        state: "ambiguous" | "permanent_failure";
        errorCode: string;
      }) =>
        npRequireAgentNotificationDeliveryCanonical({
          schemaVersion: "np.agent-notification-delivery.v1",
          siteId: f.siteId,
          notificationId: id,
          channel: "email",
          source: { incidentId, runId: null, actionId: null, transitionVersion: 1 },
          deduplicationKey,
          payloadRedacted,
          attempt: 1,
          adapter: {
            id: snapshot.adapterId,
            contractVersion: snapshot.adapterContractVersion,
            fingerprint: snapshot.adapterFingerprint,
            idempotency: "none",
          },
          connection: {
            id: snapshot.connectionId,
            configSnapshotId: snapshot.configSnapshotId,
            configVersion: snapshot.configVersion,
            configHash: snapshot.configHash,
            accountSubjectKeyId: snapshot.accountSubjectKeyId,
            accountSubjectDigest: snapshot.accountSubjectDigest,
            destinationKeyId: snapshot.destinationKeyId,
            destinationFingerprint: snapshot.destinationFingerprint,
          },
          result,
          observedAt: new Date().toISOString(),
        });
      const unknown = resultBody({ state: "ambiguous", errorCode: "DELIVERY_AMBIGUOUS" });
      await f.db
        .update(npAgentNotifications)
        .set({
          state: "failed",
          deliveryDigestBody: unknown,
          deliveryResultDigest: await npDigestAgentNotificationDeliveryCanonical(unknown),
          lastErrorCode: "DELIVERY_AMBIGUOUS",
        })
        .where(eq(npAgentNotifications.id, id));
      await blocked();
      // Test-owned reconciliation supplies an explicit known-not-sent outcome; deletion never invents one.
      const known = resultBody({ state: "permanent_failure", errorCode: "SYNTHETIC_NOT_SENT" });
      await f.db
        .update(npAgentNotifications)
        .set({
          deliveryDigestBody: known,
          deliveryResultDigest: await npDigestAgentNotificationDeliveryCanonical(known),
          lastErrorCode: "SYNTHETIC_NOT_SENT",
          updatedAt: new Date(known.observedAt),
        })
        .where(eq(npAgentNotifications.id, id));
      await blocked(); // A latest receipt without its attempt proof is insufficient.
      const details = {
        notificationId: id,
        attempt: 1,
        state: "failed",
        result: known.result,
        deliveryResultDigest: await npDigestAgentNotificationDeliveryCanonical(known),
        observedAt: known.observedAt,
      };
      await f.db.insert(npAgentIncidentTimeline).values({
        id: randomUUID(),
        siteId: f.siteId,
        incidentId,
        sequence: 1,
        kind: "notification",
        sourceKind: "system",
        sourceId: id,
        sourceFingerprint: npNotificationTimelineFingerprintV1(
          "np.agent-notification-attempt.v1",
          details,
        ),
        summary: "Synthetic completed attempt proof",
        details: { schemaVersion: "np.agent-notification-attempt.v1", ...details },
        createdAt: new Date(known.observedAt),
      });
      await deleteSite(f.siteId, { cascade: true });
      expect(await getSiteById(f.siteId)).toBeNull();
      expect(f.send).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
});
