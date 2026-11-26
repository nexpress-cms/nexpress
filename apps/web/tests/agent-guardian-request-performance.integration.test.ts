import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { npCreateProxy } from "../../../packages/app/src/proxy/index.js";
import { npCreateAgentGuardianRequestObserverV1 } from "../../../packages/app/src/lib/agents/guardian-request-observer.js";
import { resolveSiteForHostname } from "../../../packages/core/src/sites/registry.js";
import type { NpAgentGuardianObservationServiceV1 } from "../../../packages/core/src/agent/guardian-observation-service.js";
import {
  guardianAcceptanceTimeoutMs,
  guardianNetwork,
  guardianQuantiles,
  guardianReport,
  guardianRequestBudgetV1,
  guardianSourceFixture,
  skipGuardianAcceptance,
} from "./agent-guardian-acceptance-fixture.js";
import { closeTestDb, ensureMigrated, truncateAll } from "./harness.js";

/** In-process real proxy/request/source/PG path. Network transport and fixture
 * construction are excluded, not claimed as measured production latency. */
describe.skipIf(skipGuardianAcceptance)("Guardian isolated request overhead", () => {
  beforeAll(ensureMigrated);
  beforeEach(truncateAll);
  afterEach(() => vi.useRealTimers());
  afterAll(closeTestDb);

  it(
    "reports all three ABBA rounds against the frozen max(5ms, 5% baseline p95) budget",
    async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const now = new Date();
      vi.setSystemTime(now);
      const fixtureStarted = performance.now();
      const sites = Array.from({ length: 75 }, (_, index) => `guardian-perf-${index}`);
      const fixture = await guardianSourceFixture(
        [...sites, "guardian-perf-warmup"],
        () => new Date(now),
      );
      const sourceCounts = {
        recorded: 0,
        capped: 0,
        replayed: 0,
        disabled: 0,
        closed: 0,
        rejected: 0,
      };
      const observed: NpAgentGuardianObservationServiceV1 = {
        async observe(input) {
          try {
            const result = await fixture.requestSource.observe(input);
            sourceCounts[result.disposition]++;
            return result;
          } catch (error) {
            sourceCounts.rejected++;
            throw error;
          }
        },
      };
      let resolved = 0;
      const requestObserver = (guardian: NpAgentGuardianObservationServiceV1 | null) =>
        npCreateAgentGuardianRequestObserverV1({
          guardian,
          // Bootstrap completed before any measurement. This is steady-state cost.
          ensureReady: () => Promise.resolve(),
          async resolveRequest(request) {
            resolved++;
            const site = await resolveSiteForHostname(request.nextUrl.hostname);
            const networkAddress = request.headers.get("x-forwarded-for");
            return site && networkAddress ? { siteId: site.id, networkAddress } : null;
          },
        });
      const limiter = {
        kind: "memory",
        check: async () => ({ limited: true, retryAfterSeconds: 17 }),
      };
      const disabled = npCreateProxy({
        rateLimiter: limiter,
        onRateLimited: requestObserver(null).onRateLimited,
      });
      const enabled = npCreateProxy({
        rateLimiter: limiter,
        onRateLimited: requestObserver(observed).onRateLimited,
      });
      const makeRequests = (targets: readonly string[], salt: number, samples = 1000) =>
        Array.from(
          { length: samples },
          (_, index) =>
            new NextRequest(
              `https://${targets[index % targets.length]}.example.test/api/auth/login`,
              {
                headers: { "x-forwarded-for": guardianNetwork(salt + index) },
              },
            ),
        );
      // Neither warmup nor Request/UUID/site construction enters reported timings.
      const warmup = makeRequests(["guardian-perf-warmup"], 90_000, 100);
      for (const request of warmup) {
        await disabled(request);
        await enabled(request);
      }
      const fixturePreparationMs = performance.now() - fixtureStarted;
      const loop = monitorEventLoopDelay({ resolution: 10 });
      loop.enable();
      const reports: {
        round: number;
        phase: "uncapped" | "capped";
        blocks: {
          mode: string;
          elapsedMs: number;
          samples: number;
          p50Ms: number;
          p95Ms: number;
          maxMs: number;
        }[];
        disabledP95Ms: number;
        enabledP95Ms: number;
        deltaP95Ms: number;
        allowedDeltaMs: number;
        sourceCounts: typeof sourceCounts;
      }[] = [];
      const preparation: {
        round: number;
        requestConstructionMs: number;
        capPreparationMs: number;
      }[] = [];
      try {
        for (let round = 0; round < 3; round++) {
          const targets = sites.slice(round * 25, (round + 1) * 25);
          const constructionStarted = performance.now();
          const requests = Array.from({ length: 8 }, (_, block) =>
            makeRequests(targets, round * 10_000 + block * 1000),
          );
          const requestConstructionMs = performance.now() - constructionStarted;
          let capPreparationMs = 0;
          for (const phase of ["uncapped", "capped"] as const) {
            if (phase === "capped") {
              const preparationStarted = performance.now();
              // Uncapped ABBA recorded 80/site. Fill the remaining20 with the
              // same actual source through request integration, outside timings.
              for (const request of makeRequests(targets, 100_000 + round * 1000, 500))
                await enabled(request);
              capPreparationMs = performance.now() - preparationStarted;
            }
            const before = { ...sourceCounts };
            const measured = { disabled: [] as number[], enabled: [] as number[] };
            const blocks = [];
            for (const [block, mode] of ["disabled", "enabled", "enabled", "disabled"].entries()) {
              const samples = requests[(phase === "uncapped" ? 0 : 4) + block];
              const durations: number[] = [];
              const start = performance.now();
              for (const request of samples) {
                const started = performance.now();
                const response = await (mode === "disabled" ? disabled : enabled)(request);
                durations.push(performance.now() - started);
                // Response verification is outside the per-request measured span.
                expect(response.status).toBe(429);
                expect(response.headers.get("Retry-After")).toBe("17");
              }
              measured[mode as "disabled" | "enabled"].push(...durations);
              blocks.push({
                mode,
                elapsedMs: performance.now() - start,
                ...guardianQuantiles(durations),
              });
            }
            const disabledP95Ms = guardianQuantiles(measured.disabled).p95Ms;
            const enabledP95Ms = guardianQuantiles(measured.enabled).p95Ms;
            reports.push({
              round: round + 1,
              phase,
              blocks,
              disabledP95Ms,
              enabledP95Ms,
              deltaP95Ms: enabledP95Ms - disabledP95Ms,
              allowedDeltaMs: Math.max(
                guardianRequestBudgetV1.absoluteMs,
                disabledP95Ms * guardianRequestBudgetV1.baselineFraction,
              ),
              sourceCounts: {
                recorded: sourceCounts.recorded - before.recorded,
                capped: sourceCounts.capped - before.capped,
                replayed: sourceCounts.replayed - before.replayed,
                disabled: sourceCounts.disabled - before.disabled,
                closed: sourceCounts.closed - before.closed,
                rejected: sourceCounts.rejected - before.rejected,
              },
            });
          }
          preparation.push({ round: round + 1, requestConstructionMs, capPreparationMs });
        }
      } finally {
        loop.disable();
        guardianReport("request-p95", {
          budget: guardianRequestBudgetV1,
          rounds: 3,
          order: "disabled-enabled-enabled-disabled for uncapped and capped separately",
          samplesPerBlock: 1000,
          siteCountPerRound: 25,
          reports,
          fixturePreparationMs,
          preparation,
          sourceCounts,
          resolvedRequestContexts: resolved,
          databaseStatementCount: null,
          databasePoolWaitMs: null,
          eventLoopP95Ms: Number.isFinite(loop.percentile(95))
            ? loop.percentile(95) / 1_000_000
            : null,
          measuredPath:
            "real in-process proxy -> request observer -> hostname SQL -> source -> PostgreSQL",
          hostAuthority:
            "explicit local fixture source installation/authorization; no external authority service latency measured",
          excluded:
            "fixture/bootstrap/Request construction, warmup and cap preparation; network transport not measured",
          unknownMetrics:
            "SQL statement and pool-wait instrumentation unavailable; null is not zero",
        });
      }
      expect(reports).toHaveLength(6);
      for (const report of reports) {
        expect.soft(report.sourceCounts.rejected).toBe(0);
        expect.soft(report.sourceCounts.disabled).toBe(0);
        expect.soft(report.sourceCounts.closed).toBe(0);
        expect.soft(report.sourceCounts.replayed).toBe(0);
        expect.soft(report.sourceCounts.recorded).toBe(report.phase === "uncapped" ? 2000 : 0);
        expect.soft(report.sourceCounts.capped).toBe(report.phase === "capped" ? 2000 : 0);
        expect
          .soft(
            report.deltaP95Ms,
            `round${report.round} ${report.phase} p95 delta exceeds frozen budget`,
          )
          .toBeLessThanOrEqual(report.allowedDeltaMs);
      }
      expect(fixture.forbiddenCalls()).toBe(0);
    },
    guardianAcceptanceTimeoutMs,
  );
});
