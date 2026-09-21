import { and, eq, inArray } from "drizzle-orm";
import {
  NP_AGENT_MAINTENANCE_RECEIPT_KEY,
  npNextAgentMaintenanceReceiptV1,
  npRequireAgentMaintenanceReceiptV1,
} from "../agent-contract/maintenance-evidence-contract.js";
import {
  NP_AGENT_RUNTIME_JOBS_SETTING_KEY,
  npCreateAgentRuntimeJobStateV1,
  npRequireAgentRuntimeJobStateV1,
} from "../agent-contract/runtime-job-state-contract.js";
import { npSettings } from "../db/schema/system.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npWithAgentRuntimeRetentionBudgetV1 } from "./runtime-retention-budget.js";
import { npPruneAgentRuntimeRetentionV1 } from "./runtime-retention.js";

/** Explicit host job only: pruning, durable cursor and receipt commit together. */
export async function npPruneAgentRuntimeJobV1(options: {
  siteId: string;
  now?: () => Date;
}): Promise<void> {
  npAssertAgentPreviewEffectsAllowed();
  const now = options.now ?? (() => new Date());
  await npWithAgentRuntimeRetentionBudgetV1((db, beforeStatement) =>
    npWithAgentRuntimeControlTransactionV1(
      options.siteId,
      async ({ db, settings, revision }) => {
        const startedAt = now().toISOString();
        await beforeStatement();
        const rows = await db
          .select({ key: npSettings.key, value: npSettings.value })
          .from(npSettings)
          .where(
            and(
              eq(npSettings.siteId, options.siteId),
              inArray(npSettings.key, [
                NP_AGENT_RUNTIME_JOBS_SETTING_KEY,
                NP_AGENT_MAINTENANCE_RECEIPT_KEY,
              ]),
            ),
          );
        const stateRow = rows.find((row) => row.key === NP_AGENT_RUNTIME_JOBS_SETTING_KEY);
        const receiptRow = rows.find((row) => row.key === NP_AGENT_MAINTENANCE_RECEIPT_KEY);
        const state = stateRow
          ? npRequireAgentRuntimeJobStateV1(stateRow.value)
          : npCreateAgentRuntimeJobStateV1();
        const previous = receiptRow ? npRequireAgentMaintenanceReceiptV1(receiptRow.value) : null;
        const cursor = state.cursors.retention;
        const result = await npPruneAgentRuntimeRetentionV1({
          db,
          siteId: options.siteId,
          cursor,
          limit: 25,
          now: new Date(startedAt),
          settings,
          revision,
          beforeStatement,
        });
        const completedAt = now().toISOString();
        const receipt = npNextAgentMaintenanceReceiptV1(previous, {
          cursor,
          ...result,
          startedAt,
          completedAt,
        });
        // Empty sites acquire a receipt only after this explicit invocation;
        // there is no reason to create an unchanged, unrelated cursor setting.
        if (cursor !== result.nextCursor) {
          state.cursors.retention = result.nextCursor;
          await beforeStatement();
          await db
            .insert(npSettings)
            .values({
              siteId: options.siteId,
              key: NP_AGENT_RUNTIME_JOBS_SETTING_KEY,
              value: state,
              updatedAt: new Date(completedAt),
            })
            .onConflictDoUpdate({
              target: [npSettings.siteId, npSettings.key],
              set: { value: state, updatedAt: new Date(completedAt) },
            });
        }
        await beforeStatement();
        await db
          .insert(npSettings)
          .values({
            siteId: options.siteId,
            key: NP_AGENT_MAINTENANCE_RECEIPT_KEY,
            value: receipt,
            updatedAt: new Date(completedAt),
          })
          .onConflictDoUpdate({
            target: [npSettings.siteId, npSettings.key],
            set: { value: receipt, updatedAt: new Date(completedAt) },
          });
      },
      db,
    ),
  );
}
