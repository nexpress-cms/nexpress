import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npAgentEvents,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  guardianAcceptanceCount,
  guardianAcceptanceTimeoutMs,
  guardianParallel,
  guardianQuantiles,
  guardianReport,
  guardianRequestInputs,
  guardianSourceFixture,
  skipGuardianAcceptance,
} from "./agent-guardian-acceptance-fixture.js";
import { closeTestDb, ensureMigrated, truncateAll } from "./harness.js";

describe.skipIf(skipGuardianAcceptance)("Guardian exact 10k request-source capacity", () => {
  beforeAll(ensureMigrated);
  beforeEach(truncateAll);
  afterEach(() => vi.useRealTimers());
  afterAll(closeTestDb);

  it(
    "accounts for all 5000 paced + 5000 pressure attempts on one bounded real source instance",
    async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const now = new Date();
      vi.setSystemTime(now);
      const fixtureStarted = performance.now();
      const fixture = await guardianSourceFixture(["guardian-burst"], () => new Date(now));
      const inputs = guardianRequestInputs("guardian-burst", now.toISOString());
      expect(inputs).toHaveLength(guardianAcceptanceCount);
      expect(new Set(inputs.map((input) => input.observationId)).size).toBe(
        guardianAcceptanceCount,
      );
      expect(new Set(inputs.map((input) => input.networkAddress)).size).toBe(2000);
      const fixturePreparationMs = performance.now() - fixtureStarted;
      type Counts = {
        attempted: number;
        recorded: number;
        capped: number;
        replayed: number;
        disabled: number;
        closed: number;
        rejected: number;
      };
      const reports: ({
        phase: string;
        concurrency: number;
        counts: Counts;
        errors: Record<string, number>;
        elapsedMs: number;
      } & ReturnType<typeof guardianQuantiles>)[] = [];
      for (const phase of [
        { name: "paced", concurrency: 4, first: 0, end: 5000 },
        { name: "pressure", concurrency: 64, first: 5000, end: 10_000 },
      ]) {
        const counts = {
          attempted: 0,
          recorded: 0,
          capped: 0,
          replayed: 0,
          disabled: 0,
          closed: 0,
          rejected: 0,
        };
        const errors: Record<string, number> = {};
        const durations: number[] = [];
        const start = performance.now();
        await guardianParallel(
          inputs.slice(phase.first, phase.end),
          phase.concurrency,
          async (input) => {
            const started = performance.now();
            counts.attempted++;
            try {
              const result = await fixture.requestSource.observe(input);
              counts[result.disposition]++;
            } catch (error) {
              counts.rejected++;
              // Drizzle wraps driver errors. Retain only an opaque bounded code,
              // never SQL/parameters, and fail the gate on unexplained rejection.
              let code = "UNCLASSIFIED";
              let current: unknown = error;
              for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
                if (
                  "code" in current &&
                  typeof current.code === "string" &&
                  /^[A-Z0-9_]{1,64}$/u.test(current.code)
                ) {
                  code = current.code;
                  break;
                }
                current = current.cause;
              }
              errors[code] = (errors[code] ?? 0) + 1;
            } finally {
              durations.push(performance.now() - started);
            }
          },
        );
        reports.push({
          phase: phase.name,
          concurrency: phase.concurrency,
          counts,
          errors,
          elapsedMs: performance.now() - start,
          ...guardianQuantiles(durations),
        });
      }
      guardianReport("source-10000-split", {
        totalInputs: guardianAcceptanceCount,
        distinctActors: 2000,
        oneSourceInstance: true,
        reports,
        fixturePreparationMs,
        excluded: "site/bootstrap/10000-input construction; no source attempts excluded",
        sourceErrorBasis:
          "opaque owner codes; rejected inputs are not assumed to be only in-flight pressure",
        basis: "actual-attempts; capped/rejected inputs are uncovered, not recorded",
      });
      const total = (key: keyof (typeof reports)[number]["counts"]) =>
        reports.reduce((sum, report) => sum + report.counts[key], 0);
      expect(total("attempted")).toBe(guardianAcceptanceCount);
      expect(
        total("recorded") +
          total("capped") +
          total("replayed") +
          total("disabled") +
          total("closed") +
          total("rejected"),
      ).toBe(guardianAcceptanceCount);
      expect(total("recorded")).toBe(100);
      expect(total("capped")).toBeGreaterThan(0);
      expect(total("replayed")).toBe(0);
      expect(total("disabled")).toBe(0);
      expect(total("closed")).toBe(0);
      expect(reports[1].counts.rejected).toBeGreaterThan(0);
      for (const report of reports)
        expect(
          Object.keys(report.errors).every((code) =>
            ["GUARDIAN_OBSERVATION_UNAVAILABLE", "55P03", "57014"].includes(code),
          ),
          `Unexplained source rejection: ${JSON.stringify(report.errors)}`,
        ).toBe(true);
      const events = await fixture.db
        .select()
        .from(npAgentEvents)
        .where(eq(npAgentEvents.siteId, "guardian-burst"));
      expect(events).toHaveLength(total("recorded"));
      expect(events.every((event) => event.dispatchedAt !== null)).toBe(true);
      const signals = await fixture.db
        .select()
        .from(npAgentSignals)
        .where(eq(npAgentSignals.siteId, "guardian-burst"));
      expect(signals.length).toBeGreaterThan(0);
      expect(signals.length).toBeLessThanOrEqual(20);
      expect(signals.every((signal) => signal.evidence.length === 5)).toBe(true);
      expect(await fixture.db.select().from(npAgentRuns)).toHaveLength(0);
      expect(fixture.forbiddenCalls()).toBe(0);
    },
    guardianAcceptanceTimeoutMs,
  );
});
