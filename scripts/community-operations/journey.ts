import assert from "node:assert/strict";
import { open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { npAgentActions, npAgentProviderCalls, npReports } from "@nexpress/core";
import { npAgentModeratorWindowStartedAtV1 } from "@nexpress/core/agents";
import {
  npRequireAgentApprovalChallengeOutputV1,
  npRequireAgentApprovalDetailV1,
  npRequireAgentIncidentEvidenceV1,
  npRequireAgentIncidentNotificationsV1,
  npRequireAgentIncidentStudioDetailV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentIncidentResponseCapabilityV1,
} from "@nexpress/core/agent-contract";
import {
  npRequireCommentListWire,
  npRequireCommentWireRow,
  npRequireReportWireRow,
} from "@nexpress/core/community-contract";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { getSiteById } from "@nexpress/core/sites";
import { count, eq, inArray } from "drizzle-orm";
import { communityPilot, ensureFor, getDb, shutdownBootstrap } from "../../src/lib/bootstrap.js";

const [phase, directory] = process.argv.slice(2);
const password = process.env.NP_COMMUNITY_PILOT_PASSWORD;
const configuredOrigin = process.env.SITE_URL;
if (
  !directory ||
  !password ||
  !configuredOrigin ||
  !communityPilot ||
  !["record", "finish"].includes(phase)
) {
  throw new Error(
    "Use the configured isolated pilot with record or finish and a receipt directory.",
  );
}
const origin = configuredOrigin;
const pilot = communityPilot;
const receipts = resolve(directory);
type Session = { cookie: string; csrf: string };
const anonymous: Session = { cookie: "", csrf: "" };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid receipt or response.");
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Missing receipt value.");
  return value;
}

function uuid(value: unknown): string {
  const id = text(value);
  assert.match(id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
  return id;
}

async function readReceipt(name: string) {
  return record(JSON.parse(await readFile(resolve(receipts, name), "utf8")));
}

async function saveReceipt(name: string, value: Record<string, unknown>) {
  await writeFile(resolve(receipts, name), `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

async function request(path: string, session = anonymous, body?: Record<string, unknown>) {
  assert.ok(path.startsWith("/") && !path.startsWith("//"));
  return fetch(`${origin}${path}`, {
    redirect: "error",
    method: body ? "POST" : "GET",
    headers: {
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
}

async function readData(path: string, session = anonymous, body?: Record<string, unknown>) {
  const response = await request(path, session, body);
  const value = record(await response.json());
  if (!response.ok) {
    const code = record(value.error ?? {}).code;
    throw new Error(
      `${path} returned HTTP ${response.status}${typeof code === "string" ? ` (${code})` : ""}.`,
    );
  }
  return value;
}

async function login(user: string, member: boolean): Promise<Session> {
  const response = await request(member ? "/api/members/login" : "/api/auth/login", anonymous, {
    email: `${user}@example.test`,
    password,
  });
  assert.ok(response.ok, `Password login failed for the ${member ? "member" : "staff"} fixture.`);
  const csrfName = member ? "np-mb-csrf" : "np-csrf";
  const pairs = response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
  const csrf = pairs.find((pair) => pair.startsWith(`${csrfName}=`))?.slice(csrfName.length + 1);
  assert.ok(csrf, "Expected the app's CSRF cookie after password login.");
  return { cookie: pairs.join("; "), csrf };
}

try {
  await ensureFor("read");
  const db = getDb();
  const site = await readReceipt("site.json");
  const siteId = text(site.siteId);
  const deployed = await getSiteById(siteId);
  assert.equal(siteId, "default");
  assert.equal(site.origin, origin);
  assert.ok(
    deployed?.settings.siteUrl && new URL(deployed.settings.siteUrl).origin === origin,
    "Site identity does not match the deployment.",
  );
  assert.equal((await request("/api/health/ready")).status, 200);
  const buildId = (await readFile(".next/BUILD_ID", "utf8")).trim();
  assert.ok(buildId);

  if (phase === "record") {
    const reservation = await open(resolve(receipts, "record.lock"), "wx", 0o600);
    await reservation.close();
    assert.ok(Array.isArray(site.boards));
    assert.deepEqual(
      site.boards.map((item) => text(record(item).key)),
      ["notice", "questions", "general"],
    );
    for (const { key } of site.boards.map(record)) {
      assert.equal((await request(`/boards/${text(key)}`)).status, 200);
    }
    const board = site.boards.map(record).find((item) => item.key === "questions");
    assert.ok(board);
    const authors = await Promise.all(
      ["member-one", "member-two", "member-three"].map((user) => login(user, true)),
    );
    const reporter = await login("reporter", true);
    const body = npCreateEmptyRichTextContent();
    body.document.root.children[0].children = [
      {
        type: "text",
        version: 1,
        text: "로컬 개발 환경을 구성하는 방법이 궁금합니다.",
        format: 0,
        detail: 0,
        mode: "normal",
        style: "",
      },
    ];
    const post = record(
      await readData("/api/collections/forum-posts", authors[0], {
        board: uuid(board.id),
        title: "개발 환경 설정 질문",
        body,
        audience: "public",
      }),
    );
    const postId = uuid(post.id);
    const thread = `/boards/questions/${postId}`;
    const publicThread = await request(thread);
    assert.equal(publicThread.status, 200);
    assert.ok((await publicThread.text()).includes("개발 환경 설정 질문"));
    const commentsPath = `/api/collections/forum-posts/${postId}/comments`;
    // Each observation must belong to the same real detector window.
    const remaining = 600_000 - (Date.now() % 600_000);
    if (remaining < 30_000) await setTimeout(remaining + 1_000);
    const comments = [];
    for (let index = 0; index < 5; index++) {
      comments.push(
        npRequireCommentWireRow(
          await readData(commentsPath, authors[index % authors.length], {
            bodyMd: `합성 관측 ${index + 1} https://offers.example.test/resource/${index + 1}`,
            parentId: null,
          }),
        ),
      );
    }
    const target = comments[0];
    const report = npRequireReportWireRow(
      await readData("/api/reports", reporter, {
        targetType: "comment",
        targetId: target.id,
        reason: "반복 링크 검토 요청",
      }),
    );
    const windowStartedAt = npAgentModeratorWindowStartedAtV1(report.createdAt);
    assert.ok(
      comments.every(
        (comment) => npAgentModeratorWindowStartedAtV1(comment.createdAt) === windowStartedAt,
      ),
    );
    await saveReceipt("recorded.json", {
      siteId,
      origin,
      buildId,
      postId,
      reportId: report.id,
      targetId: target.id,
      windowStartedAt,
    });
    console.log("One report and five original comment observations recorded.");
  } else {
    const saved = await readReceipt("recorded.json");
    assert.deepEqual([saved.siteId, saved.origin, saved.buildId], [siteId, origin, buildId]);
    const windowStartedAt = text(saved.windowStartedAt);
    const postId = uuid(saved.postId);
    const targetId = uuid(saved.targetId);
    const reportId = uuid(saved.reportId);
    const reports = await db
      .select({
        id: npReports.id,
        targetId: npReports.targetId,
        targetType: npReports.targetType,
        createdAt: npReports.createdAt,
      })
      .from(npReports)
      .where(eq(npReports.siteId, siteId))
      .limit(2);
    assert.equal(reports.length, 1, "Expected exactly one original site report.");
    assert.deepEqual(
      [reports[0].id, reports[0].targetId, reports[0].targetType],
      [reportId, targetId, "comment"],
    );
    assert.equal(
      npAgentModeratorWindowStartedAtV1(reports[0].createdAt.toISOString()),
      windowStartedAt,
    );
    const commentsPath = `/api/collections/forum-posts/${postId}/comments`;
    const hasPublicComment = async () =>
      npRequireCommentListWire(await readData(commentsPath)).comments.some(
        (comment) => comment.id === targetId,
      );

    const windowClosedAt = Date.parse(windowStartedAt) + 600_000;
    assert.ok(Number.isFinite(windowClosedAt) && windowClosedAt <= Date.now() + 600_000);
    if (windowClosedAt > Date.now()) {
      console.log("Waiting for the existing detector's observation window to close.");
      await setTimeout(windowClosedAt - Date.now() + 100);
    }

    const observation = await pilot.collect(windowStartedAt);
    assert.equal(observation.acceptedFacts, 6);
    assert.equal(observation.observations.length, 1, "Expected one advisory Incident.");
    const incidentId = observation.observations[0].incidentId;
    const replay = await pilot.collect(windowStartedAt);
    assert.deepEqual(
      replay.observations.map(({ incidentId, disposition }) => ({ incidentId, disposition })),
      [{ incidentId, disposition: "replayed" }],
    );
    const requester = await login("requester", false);
    const approver = await login("approver", false);
    const incidentPath = `/api/admin/agents/incidents/${incidentId}`;
    const evidence = npRequireAgentIncidentEvidenceV1(
      await readData(`${incidentPath}/evidence`, requester),
    );
    assert.equal(evidence.incidentId, incidentId);
    const reportEvidence = evidence.items.find(
      (item) => item.target?.id === targetId && item.observed?.reportFiled === true,
    );
    assert.equal(reportEvidence?.current?.report?.status, "unresolved");
    assert.ok(reportEvidence?.responseEligible);
    const incident = async () =>
      npRequireAgentIncidentStudioDetailV1(await readData(incidentPath, requester));
    const feed = npRequireAgentIncidentNotificationsV1(
      await readData("/api/admin/agents/incidents/notifications", requester),
    );
    const notices = feed.items.filter(
      (item) => item.incidentId === incidentId && item.transition === "opened",
    );
    assert.equal(notices.length, 1, "Replay must not duplicate the Admin notification.");
    assert.ok(await hasPublicComment());

    async function approveResponse(capability: NpAgentIncidentResponseCapabilityV1) {
      const detail = await incident();
      const matches = (item: { capabilityId: string; target: { id: string } }) =>
        item.capabilityId === capability && item.target.id === targetId;
      const choice = detail.response?.choices.find(matches);
      assert.ok(choice, `Missing authorized ${capability} choice for the filed report.`);
      assert.ok(
        !detail.response?.plans.some(matches),
        "Use a fresh fixture after leaving a response plan bound to an earlier staff session.",
      );
      const restoring = capability === "moderation.restore";
      const key = `community-pilot:${reportId}:${restoring ? "restore" : "quarantine"}`;
      await readData(`${incidentPath}/response-plan`, requester, {
        schemaVersion: "np.agent-incident-response-plan-input.v1",
        expectedVersion: detail.incident.versionNumber,
        capabilityId: capability,
        proposal: restoring
          ? {
              containmentKind: "content_quarantine",
              containmentId: uuid(choice.containmentId),
              expectedVersionDigest: choice.expectedVersionDigest,
            }
          : {
              incidentId,
              target: choice.target,
              expectedVersionDigest: choice.expectedVersionDigest,
              reasonCode: "REPEATED_LINK_REVIEW",
            },
        idempotencyKey: `${key}:plan`,
      });
      assert.equal(
        await hasPublicComment(),
        !restoring,
        "Planning must not change public visibility.",
      );
      const plan = (await incident()).response?.plans.find(matches);
      assert.ok(plan);
      const approvalPath = `/api/admin/agents/approvals/${plan.approvalId}`;
      const { item: approval } = npRequireAgentApprovalDetailV1(
        await readData(approvalPath, approver),
      );
      assert.ok(approval.allowedDecisions.includes("approve"));
      const challengeInput = {
        schemaVersion: "np.agent-approval-challenge-request.v1",
        purpose: "approve",
        expectedApprovalVersion: approval.version,
        statementHash: approval.statementHash,
        idempotencyKey: `${key}:challenge`,
      };
      const self = await request(`${approvalPath}/decision-challenge`, requester, {
        ...challengeInput,
        idempotencyKey: `${key}:self`,
      });
      assert.ok([403, 404, 409].includes(self.status), `Self approval returned ${self.status}.`);
      const challenge = npRequireAgentApprovalChallengeOutputV1(
        await readData(`${approvalPath}/decision-challenge`, approver, challengeInput),
      );
      const approved = npRequireAgentApprovalDetailV1(
        await readData(`${approvalPath}/approve`, approver, {
          schemaVersion: "np.agent-approval-decision-input.v1",
          expectedApprovalVersion: challenge.approvalVersion,
          statementHash: approval.statementHash,
          challengeGeneration: challenge.challengeGeneration,
          challenge: challenge.challenge,
          idempotencyKey: `${key}:approve`,
          reason: "Scoped community pilot review",
        }),
      );
      assert.equal(approved.item.approval.state, "approved");
      assert.equal(await hasPublicComment(), !restoring, "Approval must not execute the action.");
      const ready = await incident();
      assert.ok(
        ready.response?.plans.find((entry) => entry.actionId === plan.actionId)?.canExecute,
        "The current requester's session must be able to execute the approved plan.",
      );
      const execution = {
        schemaVersion: "np.agent-incident-response-execute-input.v1",
        expectedVersion: ready.incident.versionNumber,
        actionId: plan.actionId,
        approvalId: plan.approvalId,
        proposalHash: plan.proposalHash,
        idempotencyKey: `${key}:execute`,
      };
      const route = restoring ? "restore" : "response-plan/execute";
      for (const replayed of [false, true]) {
        const applied = npRequireAgentRuntimeStudioMutationResultV1(
          await readData(`${incidentPath}/${route}`, requester, execution),
        );
        assert.equal(applied.resourceId, incidentId);
        assert.equal(applied.replayed, replayed);
      }
      assert.equal(await hasPublicComment(), restoring);
      return { actionId: plan.actionId, approvalId: plan.approvalId };
    }

    const quarantine = await approveResponse("moderation.quarantine");
    const restore = await approveResponse("moderation.restore");
    const actions = await db
      .select({ verification: npAgentActions.verificationState })
      .from(npAgentActions)
      .where(inArray(npAgentActions.id, [quarantine.actionId, restore.actionId]));
    assert.equal(actions.length, 2);
    assert.ok(actions.every((action) => action.verification === "passed"));
    const dismissed = npRequireReportWireRow(
      await readData(`/api/admin/community/reports/${reportId}/resolve`, requester, {
        action: "dismiss",
      }),
    );
    assert.equal(dismissed.id, reportId);
    assert.ok(dismissed.resolvedAt);
    assert.ok(await hasPublicComment());
    const incidentPage = `/admin/agents/incidents/${incidentId}`;
    assert.equal((await request(incidentPage, requester)).status, 200);
    const [usage] = await db.select({ calls: count() }).from(npAgentProviderCalls);
    assert.equal(usage?.calls, 0);
    await saveReceipt("operations-handoff.json", {
      ...saved,
      schemaVersion: "np.community-operations-pilot.v1",
      scope: "isolated-community-pilot",
      incidentId,
      incidentPath: incidentPage,
      nextAction: "Review the Incident and the two verified decisions in Agent Studio.",
      reports: reports.length,
      reportEventId: reportEvidence.eventId,
      reportResolvedAt: dismissed.resolvedAt,
      openedNotifications: notices.length,
      quarantine,
      restore,
      verification: {
        removedFromPublicComments: true,
        restoredToPublicComments: true,
        providerCalls: 0,
      },
    });
    console.log(
      "Retained one Incident and notification, approved both actions and verified public restoration.",
    );
  }
} finally {
  await shutdownBootstrap();
}
