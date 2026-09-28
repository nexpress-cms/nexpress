import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NpForbiddenError } from "@nexpress/core";
import { npApiErrorDiagnosticsHeader } from "@nexpress/core/api-contract";

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  staff: vi.fn(),
  ensure: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  feedback: vi.fn(),
  transition: vi.fn(),
}));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.runtime,
}));
vi.mock("./studio-admin", () => ({
  requireAgentStudioAdmin: mocks.staff,
  normalizeAgentStudioError: (error: unknown) => error,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensure }));
import { handleAgentIncidentAdminRequest } from "./incident-admin";

const id = "10000000-0000-4000-8000-000000000001";
const staff = { siteId: "default", actor: { user: { id }, sessionId: id } };
const command = {
  schemaVersion: "np.agent-incident-feedback-input.v1",
  expectedVersion: 2,
  signalId: id,
  label: "false-positive",
  supersedesId: null,
  idempotencyKey: "incident-feedback-attempt",
};
function request(query = "", body?: unknown) {
  return new NextRequest(
    `https://site.example/api/admin/agents/incidents${query}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue(staff);
  mocks.runtime.mockReturnValue({ incidents: mocks });
  mocks.list.mockResolvedValue({
    schemaVersion: "np.agent-incident-list.v1",
    items: [],
    nextCursor: null,
  });
  mocks.feedback.mockResolvedValue({ resourceId: id, replayed: false, output: "private-output" });
  mocks.transition.mockResolvedValue({ resourceId: id, replayed: false, output: "private-output" });
});
describe("Incident Studio HTTP boundary", () => {
  it("checks current staff before resolving installed Incident service", async () => {
    mocks.staff.mockRejectedValue(new NpForbiddenError("agent-studio", "manage"));
    expect((await handleAgentIncidentAdminRequest(request(), "list")).status).toBe(403);
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("keeps absent installation distinct from empty pages with operation-specific recovery", async () => {
    mocks.runtime.mockReturnValue({ incidents: null });
    for (const operation of ["list", "feedback", "transition"] as const) {
      const response = await handleAgentIncidentAdminRequest(request(), operation, id);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(JSON.parse(response.headers.get(npApiErrorDiagnosticsHeader)!)).toMatchObject({
        recovery: operation === "list" ? "retry-read" : "check-outcome",
      });
    }
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.feedback).not.toHaveBeenCalled();
  });
  it("decodes exact bounded filters and server-selected staff/site", async () => {
    const response = await handleAgentIncidentAdminRequest(
      request("?statuses=open,investigating&categories=spam&severities=high&limit=5"),
      "list",
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({
      ...staff,
      query: {
        statuses: ["open", "investigating"],
        categories: ["spam"],
        severities: ["high"],
        updatedAfter: null,
        limit: 5,
        cursor: null,
      },
    });
    expect(mocks.ensure).toHaveBeenCalledWith("read");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      schemaVersion: "np.agent-incident-list.v1",
      items: [],
      nextCursor: null,
    });
  });
  it.each([
    "?statuses=open,open",
    "?statuses=",
    "?limit=101",
    "?limit=01",
    "?limit=2&limit=2",
    "?siteId=other",
    "?__proto__=value",
    "?cursor=",
    "?cursor=" + "x".repeat(2049),
    "?updatedAfter=yesterday",
  ])("rejects ambiguous/unsupported query %s", async (query) => {
    expect((await handleAgentIncidentAdminRequest(request(query), "list")).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("validates IDs and accepts only timeline cursor for detail", async () => {
    for (const [query, target] of [
      ["", "bad-id"],
      ["?statuses=open", id],
      ["?cursor=a&cursor=b", id],
    ]) {
      expect((await handleAgentIncidentAdminRequest(request(query), "detail", target)).status).toBe(
        400,
      );
    }
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.get.mockRejectedValue(new NpForbiddenError("incident", "read"));
    expect(
      (await handleAgentIncidentAdminRequest(request("?cursor=sealed-cursor"), "detail", id))
        .status,
    ).toBe(403);
    expect(mocks.get).toHaveBeenCalledWith({ ...staff, incidentId: id, cursor: "sealed-cursor" });
  });
  it("projects bounded detail and rejects response identity or private field injection", async () => {
    const time = "2026-09-27T00:00:00.000Z";
    const detail = {
      schemaVersion: "np.agent-incident-studio-detail.v1",
      incident: {
        version: "np.agent-incident.v1",
        id,
        siteId: "default",
        fingerprint: "detector.key",
        category: "spam",
        severity: "high",
        status: "open",
        title: "Spam signal",
        summary: "Deterministic source observation",
        primarySubject: null,
        assignedAgentId: null,
        signalIds: [id],
        eventCount: 1,
        firstObservedAt: time,
        lastObservedAt: time,
        containedAt: null,
        resolvedAt: null,
        resolutionCode: null,
        versionNumber: 1,
        createdAt: time,
        updatedAt: time,
      },
      signals: [
        {
          id,
          detectorId: "repeated-link",
          detectorVersion: 1,
          category: "spam",
          confidenceBasis: "exact-rule",
          scoreBasisPoints: null,
          createdAt: time,
        },
      ],
      timeline: [
        {
          id,
          sequence: 1,
          kind: "observed",
          createdAt: time,
          approvalId: null,
          actionId: null,
          decision: null,
        },
      ],
      nextTimelineCursor: null,
      feedback: [],
      feedbackAvailable: false,
      workflow: null,
    };
    mocks.get.mockResolvedValue(detail);
    const response = await handleAgentIncidentAdminRequest(request(), "detail", id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    for (const output of [
      { ...detail, incident: { ...detail.incident, siteId: "other" } },
      { ...detail, incident: { ...detail.incident, id: "20000000-0000-4000-8000-000000000002" } },
      { ...detail, timeline: [{ ...detail.timeline[0], rawDetails: "private-evidence" }] },
    ]) {
      mocks.get.mockResolvedValue(output);
      const rejected = await handleAgentIncidentAdminRequest(request(), "detail", id);
      expect(rejected.status).toBe(500);
      expect(await rejected.text()).not.toContain("private-evidence");
    }
  });
  it("passes exact feedback command and exposes only bound acknowledgement", async () => {
    const response = await handleAgentIncidentAdminRequest(request("", command), "feedback", id);
    expect(response.status).toBe(200);
    expect(mocks.ensure).toHaveBeenCalledWith("write");
    expect(mocks.feedback).toHaveBeenCalledWith({ ...staff, incidentId: id, command });
    expect(await response.json()).toEqual({ resourceId: id, replayed: false });
    mocks.feedback.mockResolvedValue({
      resourceId: "20000000-0000-4000-8000-000000000002",
      replayed: false,
    });
    expect(
      (await handleAgentIncidentAdminRequest(request("", command), "feedback", id)).status,
    ).toBe(500);
  });
  it("rejects feedback authority injection, query injection, and oversized JSON before dispatch", async () => {
    for (const [query, body] of [
      ["", { ...command, siteId: "other" }],
      ["?cursor=anything", command],
      ["", { ...command, idempotencyKey: "x".repeat(4097) }],
    ] as const) {
      expect(
        (await handleAgentIncidentAdminRequest(request(query, body), "feedback", id)).status,
      ).toBe(400);
    }
    expect(mocks.feedback).not.toHaveBeenCalled();
  });
  it("conceals malformed read projections and internal failures", async () => {
    mocks.list.mockResolvedValue({ rawBody: "private-body" });
    mocks.get.mockResolvedValue({ rawBody: "private-body" });
    for (const operation of ["list", "detail"] as const) {
      const response = await handleAgentIncidentAdminRequest(request(), operation, id);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("private-body");
    }
    mocks.feedback.mockRejectedValue(new Error("private-token"));
    const response = await handleAgentIncidentAdminRequest(request("", command), "feedback", id);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-token");
  });
});

describe("Incident transition HTTP boundary", () => {
  const transitionCommand = {
    schemaVersion: "np.agent-incident-transition-input.v1",
    expectedVersion: 2,
    transition: "resolved",
    resolutionCode: "REMEDIATED",
    note: "Reviewed the source and retained quarantine.",
    containmentReviewHash: `cj1:sha256:${"A".repeat(43)}`,
    containmentDisposition: "retain",
    idempotencyKey: "incident-transition-attempt",
  };
  it("dispatches the exact staff-bound transition and limits its acknowledgement", async () => {
    const response = await handleAgentIncidentAdminRequest(
      request("", transitionCommand),
      "transition",
      id,
    );
    expect(response.status).toBe(200);
    expect(mocks.ensure).toHaveBeenCalledWith("write");
    expect(mocks.transition).toHaveBeenCalledWith({
      ...staff,
      incidentId: id,
      command: transitionCommand,
    });
    expect(await response.json()).toEqual({ resourceId: id, replayed: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    mocks.transition.mockResolvedValue({
      resourceId: "20000000-0000-4000-8000-000000000002",
      replayed: false,
    });
    expect(
      (await handleAgentIncidentAdminRequest(request("", transitionCommand), "transition", id))
        .status,
    ).toBe(500);
  });
  it("rejects injected authority, query and oversized or unsupported commands before dispatch", async () => {
    for (const [query, body] of [
      ["", { ...transitionCommand, siteId: "other" }],
      ["?cursor=anything", transitionCommand],
      ["", { ...transitionCommand, transition: "contained" }],
      ["", { ...transitionCommand, note: "x".repeat(16385) }],
    ] as const) {
      expect(
        (await handleAgentIncidentAdminRequest(request(query, body), "transition", id)).status,
      ).toBe(400);
    }
    expect(mocks.transition).not.toHaveBeenCalled();
  });
  it("returns safe mutation recovery for unknown outcomes", async () => {
    mocks.transition.mockRejectedValue(new Error("private-transition-evidence"));
    const response = await handleAgentIncidentAdminRequest(
      request("", transitionCommand),
      "transition",
      id,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-transition-evidence");
    expect(JSON.parse(response.headers.get(npApiErrorDiagnosticsHeader)!)).toMatchObject({
      recovery: "check-outcome",
    });
  });
});
