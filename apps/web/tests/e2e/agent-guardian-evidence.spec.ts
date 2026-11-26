import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Route } from "@playwright/test";
import {
  npRequireAgentGuardianIncidentExportV1,
  npRequireAgentIncidentStudioDetailV1,
  type NpAgentIncidentStudioDetailV1,
} from "@nexpress/core/agent-contract";
import { serializeAgentCanonicalJson } from "../../../../packages/core/src/agent-contract/canonical-foundation.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

const runtimeId = "72111111-1111-4111-8111-111111111111";
const httpId = "73111111-1111-4111-8111-111111111111";
const runtimeSignal = "74111111-1111-4111-8111-111111111111";
const httpSignal = "75111111-1111-4111-8111-111111111111";
const at = "2026-10-18T00:00:00.000Z";
const end = "2026-10-18T00:00:01.000Z";
const digest = `cj1:sha256:${"R".repeat(43)}`;
const privateBucket = "PRIVATE_NETWORK_BUCKET_" + "Q".repeat(20);
const privateProvider = "PRIVATE_PROVIDER_PROSE_DO_NOT_RENDER";

function detail(source: "runtime" | "http", versionNumber = 1) {
  const runtime = source === "runtime";
  const id = runtime ? runtimeId : httpId;
  const signalId = runtime ? runtimeSignal : httpSignal;
  const detectorId = runtime ? "guardian.action-velocity" : "guardian.http-responses";
  const category = runtime ? "agent-abuse" : "traffic";
  return npRequireAgentIncidentStudioDetailV1({
    schemaVersion: "np.agent-incident-studio-detail.v1",
    incident: {
      version: "np.agent-incident.v1",
      id,
      siteId: "default",
      fingerprint: `browser-${source}`,
      category,
      severity: runtime ? "medium" : "low",
      status: "open",
      title: runtime
        ? "Committed Runtime Actions for review"
        : "HTTP response observations for review",
      summary: "Retained source facts require review; they do not establish malicious intent.",
      primarySubject: runtime
        ? { kind: "agent", agentId: runtimeId, agentVersionId: null }
        : {
            kind: "actor-bucket",
            purpose: "network-address",
            projectionVersion: 1,
            projectionFingerprint: "cj1:sha256:Tc2eBqJQ_cAuxaxGRLnoMlroKzxPGqgc5O9cQNcCJjk",
            keyId: "browser-http",
            bucket: privateBucket,
          },
      assignedAgentId: null,
      signalIds: [signalId],
      eventCount: 5,
      firstObservedAt: at,
      lastObservedAt: end,
      containedAt: null,
      resolvedAt: null,
      resolutionCode: null,
      versionNumber,
      createdAt: at,
      updatedAt: end,
    },
    signals: [
      {
        id: signalId,
        detectorId,
        detectorVersion: 1,
        confidenceBasis: "exact-rule",
        scoreBasisPoints: null,
        category,
        createdAt: end,
      },
    ],
    timeline: [
      {
        id,
        sequence: 1,
        kind: "observed",
        createdAt: end,
        approvalId: null,
        actionId: null,
        decision: null,
      },
    ],
    nextTimelineCursor: null,
    timelinePageComplete: true,
    feedback: [],
    feedbackAvailable: false,
    response: null,
    workflow: null,
    ...(runtime
      ? {
          guardianRuntimeEvidence: [
            {
              schemaVersion: "np.agent-guardian-runtime-evidence.v1",
              signalId,
              detectorId,
              detectorVersion: 1,
              window: { startedAt: at, endedAt: end },
              basis: "admitted-actions",
              observedCount: 5,
              countBasis: "at-least",
              assessment: "review-only",
              accounting: null,
              sourceDigest: digest,
            },
          ],
        }
      : {
          guardianHttpEvidence: [
            {
              schemaVersion: "np.agent-guardian-http-evidence.v1",
              signalId,
              detectorId,
              detectorVersion: 1,
              status: 404,
              routeFamily: "cms",
              window: { startedAt: at, endedAt: end },
              observedCount: 5,
              countBasis: "at-least",
              assessment: "review-only",
              sourceDigest: digest,
            },
          ],
        }),
  });
}

function exportBody(source: "runtime" | "http", version: number) {
  const snapshot = detail(source, version);
  const incident = snapshot.incident;
  const body = {
    schemaVersion: "np.agent-guardian-incident-export.v1",
    exportedAt: end,
    completeness: "complete",
    incident: {
      id: incident.id,
      siteId: incident.siteId,
      versionNumber: incident.versionNumber,
      category: incident.category,
      severity: incident.severity,
      status: incident.status,
      eventCount: incident.eventCount,
      firstObservedAt: at,
      lastObservedAt: end,
      createdAt: at,
      updatedAt: end,
    },
    signals: snapshot.signals,
    sources: [
      {
        signalId: snapshot.signals[0].id,
        source,
        startedAt: at,
        endedAt: end,
        observedCount: 5,
        countBasis: "at-least",
        sourceDigest: digest,
        impact: "site",
        affectedSiteCount: 1,
      },
    ],
    outcomes: snapshot.timeline.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      kind: entry.kind,
      createdAt: entry.createdAt,
      assessment: null,
    })),
  };
  return npRequireAgentGuardianIncidentExportV1({
    ...body,
    checksum: `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(body)).digest("base64url")}`,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => (resolve = complete));
  return { promise, resolve };
}

test("mobile Guardian source review downloads only current safe evidence and redacts access loss", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    134 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  await page.setViewportSize({ width: 390, height: 900 });
  for (const pattern of [
    "**/api/admin/agents/incidents/notifications*",
    "**/api/admin/agents/incidents/*/deliveries*",
    "**/api/admin/agents/incidents/*/assignment",
    "**/api/admin/agents/incidents/*/evidence*",
  ])
    await page.route(pattern, (route) => route.fulfill({ status: 503, json: {} }));
  let runtimeVersion = 1;
  let httpVersion = 1;
  let mode: "success" | "stale" | "failure" | "held" | "denied" = "success";
  const held = deferred<Route>();
  const releaseHeld = deferred<void>();
  const heldFinished = deferred<void>();
  page.once("close", () => releaseHeld.resolve());
  const downloads: Download[] = [];
  const mutations: string[] = [];
  const versions: string[] = [];
  page.on("download", (download) => downloads.push(download));
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      new URL(request.url()).pathname.startsWith("/api/admin/agents/")
    )
      mutations.push(request.url());
  });
  await page.route(new RegExp(`/api/admin/agents/incidents/(${runtimeId}|${httpId})$`), (route) => {
    const runtime = new URL(route.request().url()).pathname.endsWith(runtimeId);
    return route.fulfill({
      json: detail(runtime ? "runtime" : "http", runtime ? runtimeVersion : httpVersion),
    });
  });
  await page.route(
    /\/api\/admin\/agents\/incidents\/[^/]+\/guardian-export\?version=\d+$/,
    async (route) => {
      const url = new URL(route.request().url());
      const runtime = url.pathname.includes(runtimeId);
      const version = Number(url.searchParams.get("version"));
      versions.push(`${runtime ? "runtime" : "http"}:${version}`);
      if (mode === "held" && runtime) {
        held.resolve(route);
        await releaseHeld.promise;
        try {
          await route.fulfill({ json: exportBody("runtime", version) });
        } catch (error) {
          if (!page.isClosed() && !route.request().failure()) throw error;
        } finally {
          heldFinished.resolve();
        }
        return;
      }
      if (mode === "failure")
        return route.fulfill({ status: 503, contentType: "text/plain", body: privateProvider });
      if (mode === "denied") return route.fulfill({ status: 403, json: {} });
      return route.fulfill({
        json: exportBody(runtime ? "runtime" : "http", mode === "stale" ? 1 : version),
      });
    },
  );
  const exportButton = page.getByRole("button", {
    name: "Export verified Guardian evidence",
    exact: true,
  });
  const exportPanel = page.getByRole("region", { name: "Guardian evidence export", exact: true });
  async function readDownload(download: Download, snapshot: NpAgentIncidentStudioDetailV1) {
    expect(download.suggestedFilename()).toBe(`guardian-incident-${snapshot.incident.id}.json`);
    const file = await download.path();
    if (!file) throw new Error("Expected an actual downloaded JSON file");
    const content = await readFile(file, "utf8");
    const result = npRequireAgentGuardianIncidentExportV1(JSON.parse(content));
    expect(result.incident).toMatchObject({
      id: snapshot.incident.id,
      versionNumber: snapshot.incident.versionNumber,
    });
    const { checksum, ...body } = result;
    expect(checksum).toBe(
      `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(body)).digest("base64url")}`,
    );
    expect(content).not.toContain(privateBucket);
    expect(content).not.toContain(privateProvider);
    expect(content).not.toContain("primarySubject");
  }
  async function expectReadOnlyControls() {
    await expect(page.getByRole("region", { name: "Response plans", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Guardian temporary request limits", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Guardian session revocation", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /Prepare.*(?:limit|revocation)|Execute.*approved|Restore|Record feedback/,
      }),
    ).toHaveCount(0);
  }

  await page.goto(`/admin/agents/incidents/${runtimeId}`);
  if (await page.locator('[data-np-admin-sidebar][data-open="true"]').count())
    await page.getByRole("button", { name: "Close navigation" }).last().click();
  const runtime = page.getByRole("region", { name: "Guardian Runtime observations", exact: true });
  await expect(
    runtime.getByRole("heading", { name: "Admitted Action volume", exact: true }),
  ).toBeVisible();
  await expect(runtime.getByText("At least 5 observed Actions.", { exact: true })).toBeVisible();
  await expect(
    runtime.getByText(/do not establish malicious intent or authorize a response/),
  ).toBeVisible();
  await expectReadOnlyControls();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await exportButton.focus();
  await expect(exportButton).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("guardian-runtime-evidence-390.png"),
    fullPage: true,
    animations: "disabled",
  });
  const firstDownload = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  await readDownload(await firstDownload, detail("runtime"));

  runtimeVersion = 2;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(`Incident ${runtimeId} · Version 2`, { exact: true })).toBeVisible();
  mode = "stale";
  await exportButton.click();
  await expect(exportPanel.getByRole("alert")).toBeVisible();
  expect(downloads).toHaveLength(1);
  mode = "failure";
  await exportButton.click();
  await expect(exportPanel.getByRole("alert")).toContainText("Request failed (503)");
  await expect(page.getByText(privateProvider, { exact: false })).toHaveCount(0);
  await expect(runtime).toBeVisible();

  mode = "held";
  await exportButton.click();
  await held.promise;
  mode = "denied";
  await page.goto(`/admin/agents/incidents/${httpId}`);
  const http = page.getByRole("region", { name: "Guardian HTTP responses", exact: true });
  await expect(http.getByRole("heading", { name: "HTTP 404 · cms", exact: true })).toBeVisible();
  await expect(http.getByText(/does not establish an attack or identify a person/)).toBeVisible();
  await expect(page.getByText(privateBucket, { exact: false })).toHaveCount(0);
  await expect(http.locator("button, form")).toHaveCount(0);
  await expectReadOnlyControls();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("guardian-http-evidence-390.png"),
    fullPage: true,
    animations: "disabled",
  });
  await exportButton.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This incident is unavailable or you no longer have access." }),
  ).toBeVisible();
  await expect(http).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "HTTP response observations for review", exact: true }),
  ).toHaveCount(0);
  await expect(exportButton).toHaveCount(0);
  releaseHeld.resolve();
  await heldFinished.promise;
  expect(downloads).toHaveLength(1);

  mode = "success";
  httpVersion = 2;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(http).toBeVisible();
  const currentDownload = page.waitForEvent("download");
  await exportButton.click();
  await readDownload(await currentDownload, detail("http", 2));
  expect(downloads).toHaveLength(2);
  expect(versions).toEqual([
    "runtime:1",
    "runtime:2",
    "runtime:2",
    "runtime:2",
    "http:1",
    "http:2",
  ]);
  expect(mutations).toEqual([]);
});
