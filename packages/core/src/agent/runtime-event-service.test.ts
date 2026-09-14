import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";
import { withAgentChangeSetPreview } from "./changeset-preview-overlay.js";
import { previewFixture } from "./changeset-preview-test-fixture.js";
import * as controls from "./runtime-controls.js";
import type { NpAgentRuntimeAdmissionV1 } from "./runtime-admission.js";

const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.restoreAllMocks());
describe("Runtime event effects in the sealed preview context", () => {
  it.each(["registerTrigger", "record", "dispatch", "schedule"] as const)(
    "blocks %s before any transaction, admission or queue notification",
    async (method) => {
      const transaction = vi
        .spyOn(controls, "npWithAgentRuntimeControlTransactionV1")
        .mockImplementation(() => Promise.reject(new Error("Unexpected database admission")));
      const admit = vi.fn(() => Promise.reject(new Error("Unexpected Run admission")));
      const admission: NpAgentRuntimeAdmissionV1 = {
        admit,
        withCurrentRun: () => Promise.reject(new Error("Unexpected Run read")),
        withRunAuthority: () => Promise.reject(new Error("Unexpected authority read")),
      };
      const enqueueRun = vi.fn(() => Promise.resolve("queue-id"));
      const service = createAgentRuntimeEventServiceV1({
        admission,
        deploymentAuthority: {
          policyId: "preview-test",
          fingerprint: `cj1:sha256:${"A".repeat(43)}`,
          scopes: ["site:read"],
        },
        enqueueRun,
      });
      const operations = {
        registerTrigger: () =>
          service.registerTrigger({
            siteId: "default",
            agentId: id,
            expectedVersionId: id,
            trigger: { type: "manual", id },
            enabled: false,
          }),
        record: () =>
          service.record({
            siteId: "default",
            event: {
              version: "np.agent-event.v1",
              siteId: "default",
              kind: "ops.check.changed",
              occurredAt: new Date().toISOString(),
              source: { kind: "ops", component: "doctor" },
              subject: null,
              actor: null,
              causation: null,
              correlationId: null,
              deduplicationKey: null,
              privacy: "internal",
              payload: {
                kind: "ops.check.changed",
                checkId: "jobs.worker",
                previousStatus: "pass",
                currentStatus: "fail",
              },
            },
          }),
        dispatch: () => service.dispatch({ siteId: "default", eventId: id }),
        schedule: () => service.schedule({ siteId: "default" }),
      };
      await withAgentChangeSetPreview(await previewFixture(), async () => {
        await expect(operations[method]()).rejects.toThrow("Effects are unavailable");
      });
      expect(transaction).not.toHaveBeenCalled();
      expect(admit).not.toHaveBeenCalled();
      expect(enqueueRun).not.toHaveBeenCalled();
    },
  );
});
