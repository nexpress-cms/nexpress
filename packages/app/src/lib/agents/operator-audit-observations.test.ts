import { describe, expect, it, vi } from "vitest";
import { registerCollection } from "@nexpress/core/collections";
import type {
  NpAgentOperatorHostContextV1,
  NpAgentReadCapabilityExecutorsV1,
} from "@nexpress/core/agents";
import type {
  NpAgentAuditCheckFamily,
  NpAgentContentQueryOutputV1,
  NpAgentJsonObject,
} from "@nexpress/core/agent-contract";
import {
  collectOperatorAuditObservation,
  npDigestAgentOperatorRenderedHtmlV1,
  type NpAgentOperatorAuditObservationOwnersV1,
  type NpAgentOperatorRenderedAccessibilityReportV1,
  type NpAgentOperatorSecurityReportV1,
} from "./operator-audit-observations";

const uuid = "01900000-0000-7000-8000-000000000010";
const digest = `cj1:sha256:${"a".repeat(43)}`;
const context: Omit<NpAgentOperatorHostContextV1, "db"> = {
  siteId: "default",
  principal: {
    kind: "service",
    principalId: uuid,
    siteId: "default",
    authority: { kind: "user", userId: uuid },
    credentialId: uuid,
    gatewayExposureCeiling: "read",
    scopes: ["audit:run", "schema:read", "content:read"],
  },
  requestedAt: "2026-10-16T00:00:00.000Z",
  invocationId: uuid,
  idempotencyKey: null,
  abortSignal: new AbortController().signal,
};
const collection = "operator-audit-content";
registerCollection(
  collection,
  {},
  {
    slug: collection,
    labels: { singular: "Audit", plural: "Audits" },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "seoMetaTitle", type: "text" },
      { name: "seoMetaDescription", type: "textarea" },
      { name: "body", type: "richText" },
      { name: "privateToken", type: "text", hidden: true, required: true },
    ],
  },
);
function content(url = "/known"): NpAgentJsonObject {
  return {
    title: "Selected public document",
    seoMetaTitle: "Current title",
    seoMetaDescription: "Current description",
    body: {
      version: 1,
      document: {
        root: {
          type: "root",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [{ type: "link", version: 1, url, children: [] }],
        },
      },
    },
  };
}
function output(data = content()): NpAgentContentQueryOutputV1 {
  return {
    schemaVersion: "np.agent-content-query.v1",
    collection,
    items: [
      {
        id: uuid,
        slug: "selected",
        status: "published",
        locale: null,
        version: digest,
        digest,
        updatedAt: context.requestedAt,
        data,
      },
    ],
    nextCursor: null,
  };
}
function install() {
  const readSchema = vi.fn<NpAgentReadCapabilityExecutorsV1["schema.get"]>().mockResolvedValue({
    schemaVersion: "np.agent-schema-resource.v1",
    selector: { selector: "collection", slug: collection },
    digest,
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  });
  const readContent = vi
    .fn<NpAgentReadCapabilityExecutorsV1["content.query"]>()
    .mockResolvedValue(output());
  const routeInventory = vi.fn().mockResolvedValue({
    siteId: "default",
    complete: true,
    routes: [{ path: "/known", updatedAt: context.requestedAt }],
  });
  const owners: NpAgentOperatorAuditObservationOwnersV1 = {
    families: ["content", "seo", "links", "accessibility", "security"],
    content: { readSchema, readContent, routeInventory },
  };
  return { owners, readSchema, readContent, routeInventory };
}
function request(family: NpAgentAuditCheckFamily, maxTargets = 5) {
  // A transaction-shaped sentinel is sufficient: the installed source callbacks own all IO here.
  const db = Object.create(null) as NpAgentOperatorHostContextV1["db"];
  return {
    ...context,
    db,
    auditId: uuid,
    input: { families: [family], collections: [collection], maxTargets },
  };
}
const accessible = (html: string): NpAgentOperatorRenderedAccessibilityReportV1 => ({
  schemaVersion: "np.agent-operator-static-accessibility.v1",
  htmlDigest: npDigestAgentOperatorRenderedHtmlV1(html),
  checks: ["html.lang", "image.alt", "control.name", "link.name", "id.unique"].map((id) => ({
    id: id as NpAgentOperatorRenderedAccessibilityReportV1["checks"][number]["id"],
    status: "pass",
  })),
});
function security(): NpAgentOperatorSecurityReportV1 {
  return {
    schemaVersion: "np.agent-operator-deterministic-security.v1",
    siteId: "default",
    sourceId: "existing-deterministic-owner",
    sourceDigest: digest,
    observedAt: context.requestedAt,
    complete: true,
    checks: [{ id: "owner.integrity", status: "pass" }],
  };
}
describe("bounded actual Operator audit evidence", () => {
  it("checks only current visible public fields through the installed schema/content owners and transaction", async () => {
    const { owners, readSchema, readContent } = install();
    const input = request("content");
    const result = await collectOperatorAuditObservation(owners, "content", input, async () => {});
    expect(result).toMatchObject({ state: "ok", targetCount: 1, consumedTargets: 1 });
    expect(readSchema.mock.calls[0]?.[1].transaction).toBe(input.db);
    expect(readContent.mock.calls[0]?.[1].transaction).toBe(input.db);
    expect(readContent.mock.calls[0]?.[0]).toMatchObject({
      audience: "public",
      status: "published",
      limit: 5,
      fields: ["body", "seoMetaDescription", "seoMetaTitle", "title"],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Selected public document|Current title|privateToken/,
    );
  });
  it("reports actual schema violations and missing SEO without stale-content or body prose", async () => {
    const { owners, readContent } = install();
    readContent.mockResolvedValue(output({ seoMetaTitle: "", seoMetaDescription: "" }));
    const schema = await collectOperatorAuditObservation(
      owners,
      "content",
      request("content"),
      async () => {},
    );
    const seo = await collectOperatorAuditObservation(
      owners,
      "seo",
      request("seo"),
      async () => {},
    );
    expect(schema.state).toBe("error");
    expect(schema.evidenceRefs).toContain("finding:visible-field-contract:1");
    expect(seo.state).toBe("error");
    expect(seo.evidenceRefs).toContain("finding:missing-seo-title:1");
    expect(JSON.stringify(seo)).not.toContain("stale-content");
  });
  it("proves internal absence only with complete same-site routes and preserves unknown otherwise", async () => {
    const { owners, readContent, routeInventory } = install();
    readContent.mockResolvedValue(output(content("/absent")));
    const absent = await collectOperatorAuditObservation(
      owners,
      "links",
      request("links"),
      async () => {},
    );
    expect(absent.state).toBe("error");
    expect(absent.evidenceRefs).toContain("inventory-complete:true");
    expect(absent.evidenceRefs.some((ref) => /^inventory:cj1:sha256:/u.test(ref))).toBe(true);
    routeInventory.mockResolvedValue({
      routes: [{ updatedAt: context.requestedAt, path: "/known" }],
      complete: true,
      siteId: "default",
    });
    expect(
      await collectOperatorAuditObservation(owners, "links", request("links"), async () => {}),
    ).toEqual(absent);
    routeInventory.mockResolvedValue({ siteId: "default", complete: false, routes: [] });
    expect(
      (await collectOperatorAuditObservation(owners, "links", request("links"), async () => {}))
        .state,
    ).toBe("unknown");
    routeInventory.mockResolvedValue({ siteId: "other", complete: true, routes: [] });
    expect(
      await collectOperatorAuditObservation(owners, "links", request("links"), async () => {}),
    ).toMatchObject({ state: "unknown", consumedTargets: 5 });
  });
  it("never treats a partial or empty sample as complete and charges empty collection attempts", async () => {
    const { owners, readContent } = install();
    readContent.mockResolvedValue({ ...output(), nextCursor: "next-page" });
    expect(
      (await collectOperatorAuditObservation(owners, "seo", request("seo"), async () => {})).state,
    ).toBe("unknown");
    readContent.mockResolvedValue({ ...output(), items: [] });
    const empty = await collectOperatorAuditObservation(
      owners,
      "content",
      request("content", 1),
      async () => {},
    );
    expect(empty).toMatchObject({ state: "unknown", targetCount: 0, consumedTargets: 1 });
    expect(readContent.mock.calls[1]?.[0].limit).toBe(1);
  });
  it("keeps source failures unknown with the full attempted bound and never swallows authority or abort failures", async () => {
    const { owners, readContent } = install();
    readContent.mockRejectedValue(new Error("/private/source-failure"));
    const failed = await collectOperatorAuditObservation(
      owners,
      "content",
      request("content"),
      async () => {},
    );
    expect(failed).toMatchObject({ state: "unknown", consumedTargets: 5 });
    expect(JSON.stringify(failed)).not.toContain("private");
    let checks = 0;
    await expect(
      collectOperatorAuditObservation(owners, "content", request("content"), () => {
        checks += 1;
        if (checks === 2) throw new Error("revoked");
        return Promise.resolve();
      }),
    ).rejects.toThrow("revoked");
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectOperatorAuditObservation(
        owners,
        "content",
        { ...request("content"), abortSignal: controller.signal },
        async () => {},
      ),
    ).rejects.toThrow();
  });
  it("requires actual rendered HTML and a matching complete fixed static-check report", async () => {
    const { owners } = install();
    owners.accessibility = {
      selectRendered: () =>
        Promise.resolve({
          complete: true,
          targets: [{ html: '<html lang="en"><body>Actual</body></html>' }],
        }),
      checkRendered: (html) => Promise.resolve(accessible(html)),
    };
    const result = await collectOperatorAuditObservation(
      owners,
      "accessibility",
      request("accessibility"),
      async () => {},
    );
    expect(result).toMatchObject({ state: "ok", targetCount: 1 });
    expect(result.evidenceRefs).toContain(
      "acceptance:browser-and-assistive-technology-unestablished",
    );
    expect(JSON.stringify(result)).not.toContain("<html");
    owners.accessibility.checkRendered = (html) => {
      const report = accessible(html);
      return Promise.resolve({
        checks: report.checks.map(({ id, status }) => ({ status, id })),
        htmlDigest: report.htmlDigest,
        schemaVersion: report.schemaVersion,
      });
    };
    expect(
      await collectOperatorAuditObservation(
        owners,
        "accessibility",
        request("accessibility"),
        async () => {},
      ),
    ).toEqual(result);
    owners.accessibility.checkRendered = () => Promise.resolve(accessible("different HTML"));
    expect(
      (
        await collectOperatorAuditObservation(
          owners,
          "accessibility",
          request("accessibility"),
          async () => {},
        )
      ).state,
    ).toBe("unknown");
    delete owners.accessibility.checkRendered;
    expect(
      (
        await collectOperatorAuditObservation(
          owners,
          "accessibility",
          request("accessibility"),
          async () => {},
        )
      ).state,
    ).toBe("ok");
  });
  it("reserves the full inaccessible render sample budget and reports measured static failures", async () => {
    const { owners } = install();
    owners.accessibility = {
      selectRendered: () =>
        Promise.resolve({ complete: false, targets: [{ html: "<html>Actual</html>" }] }),
      checkRendered: (html) => {
        const report = accessible(html);
        report.checks[0].status = "fail";
        return Promise.resolve(report);
      },
    };
    const result = await collectOperatorAuditObservation(
      owners,
      "accessibility",
      request("accessibility"),
      async () => {},
    );
    expect(result).toMatchObject({ state: "error", targetCount: 1, consumedTargets: 5 });
    owners.accessibility.selectRendered = () =>
      Promise.resolve({
        complete: true,
        targets: [{ html: "x".repeat(256 * 1024 + 1) }],
      });
    expect(
      (
        await collectOperatorAuditObservation(
          owners,
          "accessibility",
          request("accessibility"),
          async () => {},
        )
      ).state,
    ).toBe("unknown");
  });
  it("uses only fresh declared deterministic security IDs and binds exact source provenance", async () => {
    const { owners } = install();
    let report = security();
    owners.security = {
      sourceId: report.sourceId,
      checkIds: ["owner.integrity"],
      read: () => Promise.resolve(report),
    };
    const observed = await collectOperatorAuditObservation(
      owners,
      "security",
      request("security"),
      async () => {},
    );
    expect(observed.state).toBe("ok");
    report = {
      checks: [{ status: "pass", id: "owner.integrity" }],
      complete: report.complete,
      observedAt: report.observedAt,
      sourceDigest: report.sourceDigest,
      sourceId: report.sourceId,
      siteId: report.siteId,
      schemaVersion: report.schemaVersion,
    };
    expect(
      await collectOperatorAuditObservation(
        owners,
        "security",
        request("security"),
        async () => {},
      ),
    ).toEqual(observed);
    report = { ...security(), checks: [{ id: "model.says-safe", status: "pass" }] };
    expect(
      (
        await collectOperatorAuditObservation(
          owners,
          "security",
          request("security"),
          async () => {},
        )
      ).state,
    ).toBe("unknown");
    report = { ...security(), observedAt: "2026-10-15T00:00:00.000Z" };
    expect(
      (
        await collectOperatorAuditObservation(
          owners,
          "security",
          request("security"),
          async () => {},
        )
      ).state,
    ).toBe("unknown");
    report = { ...security(), sourceId: "other-owner" };
    expect(
      (
        await collectOperatorAuditObservation(
          owners,
          "security",
          request("security"),
          async () => {},
        )
      ).state,
    ).toBe("unknown");
    report = { ...security(), siteId: "other-site" };
    expect(
      (
        await collectOperatorAuditObservation(
          owners,
          "security",
          request("security"),
          async () => {},
        )
      ).state,
    ).toBe("unknown");
    report = { ...security(), complete: false, checks: [] };
    expect(
      (
        await collectOperatorAuditObservation(
          owners,
          "security",
          request("security"),
          async () => {},
        )
      ).state,
    ).toBe("unknown");
  });
});
