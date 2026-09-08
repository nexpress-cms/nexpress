// eslint-disable-next-line import-x/no-relative-packages
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npSessions, npUsers } from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentPreviewAccessServiceV1 } from "../../../packages/core/src/agent/preview-access-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npAgentPreviewViewerLaunches,
  npAgentPreviewRenderSessions,
  npAgentChangesetPreviews,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  fixture,
  previewConfiguration,
  readyPreview,
  command,
  siteId,
} from "./agent-changeset-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";
const origin = "https://site.example.com";
const previewOrigin = "https://preview.example.net";
const renderOrigin = "https://127.0.0.1:39841";
function access(f: Awaited<ReturnType<typeof fixture>>, now = () => new Date()) {
  return createAgentPreviewAccessServiceV1({
    changesets: f.service,
    previewOrigin,
    servedOrigins: [origin],
    siteOrigin: async () => origin,
    signingKeys: { active: { id: "preview-signing", ...generateKeyPairSync("ed25519") } },
    sessionKeys: { active: { id: "session.1", key: new Uint8Array(32).fill(1) } },
    exchangeKeys: { active: { id: "exchange.1", key: new Uint8Array(32).fill(2) } },
    renderCookieKeys: { active: { id: "render-cookie.1", key: new Uint8Array(32).fill(3) } },
    captureKeys: { active: { id: "capture.1", key: new Uint8Array(32).fill(4) } },
    reauthentication: { verify: () => true },
    now,
    capturePlan: (preview) => [
      {
        ordinal: 1,
        route: preview.allowedRoutes[0].route,
        locale: preview.allowedRoutes[0].locale,
        audience: "public",
        viewportName: "desktop",
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
      },
      {
        ordinal: 2,
        route: preview.allowedRoutes[0].route,
        locale: preview.allowedRoutes[0].locale,
        audience: "public",
        viewportName: "mobile",
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
      },
    ],
  });
}
function exchange(html: string): string {
  return /name="exchange" value="([^"]+)"/u.exec(html)![1];
}
function cookie(headers: Record<string, string>): string {
  return headers["set-cookie"].split(";", 1)[0];
}
async function setup() {
  const f = await fixture({ preview: previewConfiguration() });
  const preview = await readyPreview(f);
  const service = access(f);
  return { ...f, preview, access: service };
}
function launchInput(f: Awaited<ReturnType<typeof setup>>, idempotencyKey = randomUUID()) {
  return {
    siteId,
    actor: f.actor.actor,
    changeSetId: f.preview.changeSetId,
    previewId: f.preview.previewId,
    command: {
      idempotencyKey,
      expectedVersion: 1,
      expectedPlanHash: f.preview.planHash,
      route: "/",
    },
  };
}
async function active(f: Awaited<ReturnType<typeof setup>>) {
  const result = await f.access.launch(launchInput(f));
  const activated = await f.access.activate({ exchange: exchange(result.html), origin });
  const [launch] = await f.db
    .select()
    .from(npAgentPreviewViewerLaunches)
    .where(eq(npAgentPreviewViewerLaunches.previewId, f.preview.previewId));
  return { launch, activated };
}
const view = (
  f: Awaited<ReturnType<typeof setup>>,
  launchId: string,
  headers: Record<string, string>,
) =>
  f.access.view({
    previewId: f.preview.previewId,
    launchId,
    encodedRoute: "%2F",
    cookie: cookie(headers),
    render: async ({ route, locale }) => ({ route, locale }),
  });
describe.skipIf(skipIfNoTestDb())("preview viewer and render access", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("admits one-time HTML exchange, atomically activates once, and never persists bearer plaintext", async () => {
    const f = await setup();
    const input = launchInput(f);
    const result = await f.access.launch(input);
    const secret = exchange(result.html);
    await expect(f.access.launch(input)).rejects.toMatchObject({
      code: "ONE_TIME_VALUE_ALREADY_ISSUED",
    });
    const [row] = await f.db.select().from(npAgentPreviewViewerLaunches);
    expect(row.state).toBe("exchange_pending");
    expect(JSON.stringify(row).includes(secret)).toBe(false);
    await expect(f.access.activate({ exchange: secret, origin: previewOrigin })).rejects.toThrow();
    const outcomes = await Promise.allSettled([
      f.access.activate({ exchange: secret, origin }),
      f.access.activate({ exchange: secret, origin }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const activated = outcomes.find((o) => o.status === "fulfilled") as PromiseFulfilledResult<{
      html: string;
      headers: Record<string, string>;
    }>;
    await expect(view(f, row.id, activated.value.headers)).resolves.toEqual({
      route: "/",
      locale: null,
    });
    const stored = JSON.stringify(await f.db.select().from(npAgentPreviewViewerLaunches));
    expect(stored.includes(secret)).toBe(false);
    expect(stored.includes(cookie(activated.value.headers).split("=")[1])).toBe(false);
  });
  it("supersedes only this staff session and increments its generation", async () => {
    const f = await setup();
    const first = await active(f);
    await f.access.launch(launchInput(f));
    const rows = await f.db.select().from(npAgentPreviewViewerLaunches);
    expect(rows.map((row) => row.generation).sort()).toEqual([1, 2]);
    expect(rows.filter((row) => row.state === "superseded")).toHaveLength(1);
    await expect(view(f, first.launch.id, first.activated.headers)).rejects.toThrow();
  });
  it("rejects cross-preview/cross-route cookies, duplicate cookies and live session invalidation", async () => {
    const f = await setup();
    const a = await active(f);
    await expect(
      f.access.view({
        previewId: randomUUID(),
        launchId: a.launch.id,
        encodedRoute: "%2F",
        cookie: cookie(a.activated.headers),
        render: async () => true,
      }),
    ).rejects.toThrow();
    await expect(
      f.access.view({
        previewId: f.preview.previewId,
        launchId: a.launch.id,
        encodedRoute: "%2Fadmin",
        cookie: cookie(a.activated.headers),
        render: async () => true,
      }),
    ).rejects.toThrow();
    await expect(
      f.access.view({
        previewId: f.preview.previewId,
        launchId: a.launch.id,
        encodedRoute: "%2F",
        cookie: `${cookie(a.activated.headers)}; ${cookie(a.activated.headers)}`,
        render: async () => true,
      }),
    ).rejects.toThrow();
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
    await expect(view(f, a.launch.id, a.activated.headers)).rejects.toThrow();
  });
  it("rechecks token version and preview currentness on every view", async () => {
    const f = await setup();
    const a = await active(f);
    await f.db
      .update(npUsers)
      .set({ tokenVersion: f.actor.actor.user.tokenVersion! + 1 })
      .where(eq(npUsers.id, f.actor.actor.user.id));
    await expect(view(f, a.launch.id, a.activated.headers)).rejects.toThrow();
  });
  it("rejects launch CAS, stale plan and undeclared route before issuing any exchange", async () => {
    const f = await setup();
    const input = launchInput(f);
    for (const changed of [
      { expectedVersion: 2 },
      { expectedPlanHash: `cj1:sha256:${"A".repeat(43)}` },
      { route: "/admin" },
    ])
      await expect(
        f.access.launch({ ...input, command: { ...input.command, ...changed } }),
      ).rejects.toThrow();
    expect(await f.db.select().from(npAgentPreviewViewerLaunches)).toHaveLength(0);
  });
  it("expires pending exchange at 30 seconds and active view at the exact live expiry", async () => {
    let current = new Date();
    const f = await setup();
    f.access = access(f, () => current);
    const result = await f.access.launch(launchInput(f));
    current = new Date(current.getTime() + 30_000);
    await expect(f.access.activate({ exchange: exchange(result.html), origin })).rejects.toThrow();
    const second = await f.access.launch(launchInput(f));
    const activated = await f.access.activate({ exchange: exchange(second.html), origin });
    const [row] = await f.db
      .select()
      .from(npAgentPreviewViewerLaunches)
      .where(eq(npAgentPreviewViewerLaunches.state, "active"));
    current = new Date(row.exp * 1000);
    await expect(view(f, row.id, activated.headers)).rejects.toThrow();
  });
  it("preserves independent sessions and enforces the exact 20-viewer cap", async () => {
    const f = await setup();
    const first = await active(f);
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.id, f.actor.actor.sessionId));
    for (let ordinal = 1; ordinal < 20; ordinal++) {
      const sessionId = randomUUID();
      await f.db.insert(npSessions).values({
        ...session,
        id: sessionId,
        accessTokenHash: randomUUID(),
        refreshTokenHash: randomUUID(),
      });
      await f.access.launch({ ...launchInput(f), actor: { ...f.actor.actor, sessionId } });
    }
    await expect(view(f, first.launch.id, first.activated.headers)).resolves.toEqual({
      route: "/",
      locale: null,
    });
    const extra = randomUUID();
    await f.db.insert(npSessions).values({
      ...session,
      id: extra,
      accessTokenHash: randomUUID(),
      refreshTokenHash: randomUUID(),
    });
    await expect(
      f.access.launch({ ...launchInput(f), actor: { ...f.actor.actor, sessionId: extra } }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { reasonCode: "PREVIEW_VIEWER_LIMIT", retryAfterSeconds: expect.any(Number) },
    });
    const rows = await f.db.select().from(npAgentPreviewViewerLaunches);
    expect(rows.filter((row) => ["active", "exchange_pending"].includes(row.state))).toHaveLength(
      20,
    );
  });
  it("denies a previously admitted viewer immediately when target read ACL narrows", async () => {
    const f = await setup();
    const a = await active(f);
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: { ...original.access, read: () => false },
    });
    await expect(view(f, a.launch.id, a.activated.headers)).rejects.toThrow();
  });
  it("denies expired renderer bootstrap without creating session authority", async () => {
    let current = new Date();
    const f = await fixture({ preview: previewConfiguration() });
    const service = access(f, () => current);
    const created = await f.service.create({ actor: f.actor, command: await command() });
    const sealed = await f.service.validate({
      actor: f.actor,
      id: created.id,
      command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
    });
    const preview = await f.service.preview({
      actor: f.actor,
      id: created.id,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        expectedPlanHash: sealed.planHash,
      },
    });
    const lease = await service.prepareRender({
      siteId,
      previewId: preview.previewId,
      origin: renderOrigin,
    });
    expect(() => JSON.stringify(lease)).toThrow();
    await lease.use(async (prepared) => {
      current = new Date(current.getTime() + 120000);
      await expect(
        service.bootstrapRender({
          token: prepared.token,
          origin: renderOrigin,
          body: prepared.bootstrapInput,
        }),
      ).rejects.toThrow();
    });
    await expect(lease.use(async () => true)).rejects.toThrow();
    expect(await f.db.select().from(npAgentPreviewRenderSessions)).toHaveLength(0);
  });
  it("atomically consumes a bootstrap and exact ordinal tickets; terminal sessions cannot replay", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const service = access(f);
    const created = await f.service.create({ actor: f.actor, command: await command() });
    const sealed = await f.service.validate({
      actor: f.actor,
      id: created.id,
      command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
    });
    const preview = await f.service.preview({
      actor: f.actor,
      id: created.id,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        expectedPlanHash: sealed.planHash,
      },
    });
    const lease = await service.prepareRender({
      siteId,
      previewId: preview.previewId,
      origin: renderOrigin,
    });
    await lease.use(async (prepared) => {
      await expect(
        service.bootstrapRender({
          token: prepared.token,
          origin: renderOrigin,
          body: { ...prepared.bootstrapInput, route: "/admin" },
        }),
      ).rejects.toThrow();
      const result = await service.bootstrapRender({
        token: prepared.token,
        origin: renderOrigin,
        body: prepared.bootstrapInput,
      });
      await expect(
        service.bootstrapRender({
          token: prepared.token,
          origin: renderOrigin,
          body: prepared.bootstrapInput,
        }),
      ).rejects.toThrow();
      const input = {
        renderSessionId: prepared.renderSessionId,
        ordinal: 1,
        cookie: result.cookie.split(";", 1)[0],
        ticket: prepared.captures[0].ticket,
      };
      await expect(service.consumeCapture({ ...input, ordinal: 2 })).rejects.toThrow();
      await expect(service.consumeCapture(input)).resolves.toMatchObject({
        capture: { ordinal: 1, route: "/" },
      });
      await expect(service.consumeCapture(input)).rejects.toThrow();
      await service.consumeCapture({ ...input, ordinal: 2, ticket: prepared.captures[1].ticket });
      const [row] = await f.db.select().from(npAgentPreviewRenderSessions);
      expect(row.state).toBe("completed");
      expect(row.consumedOrdinals).toEqual([true, true]);
      expect(JSON.stringify(row).includes(prepared.captures[0].ticket)).toBe(false);
      await expect(
        service.consumeCapture({ ...input, ordinal: 2, ticket: prepared.captures[1].ticket }),
      ).rejects.toThrow();
      const [stored] = await f.db
        .select()
        .from(npAgentChangesetPreviews)
        .where(
          and(
            eq(npAgentChangesetPreviews.id, preview.previewId),
            eq(npAgentChangesetPreviews.siteId, siteId),
          ),
        );
      expect(stored.renderBootstrapConsumedAt).not.toBeNull();
      expect(JSON.stringify(stored).includes(prepared.token)).toBe(false);
    });
    await expect(lease.use(async () => true)).rejects.toThrow();
  });
});
