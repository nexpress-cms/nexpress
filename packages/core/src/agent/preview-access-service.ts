import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentChangesets,
  npAgentChangesetPreviews,
  npAgentInvocations,
  npAgentPreviewViewerLaunches,
  npAgentPreviewRenderSessions,
} from "../db/schema/agent.js";
import { npRequireAgentChangeSetPreviewLaunchRequestV1 } from "../agent-contract/changeset-wire-contract.js";
import { npDigestAgentStaffSiteAuthorizationCanonical } from "../agent-contract/canonical-bodies.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { canonicalBodyPreviewRoute } from "../agent-contract/canonical-preview-values.js";
import {
  createAgentAdminAdmissionV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
  type NpAgentAdminAdmissionOptionsV1,
} from "./admin-admission.js";
import type { NpAgentChangeSetServiceV1 } from "./changeset-service.js";
import type { NpAgentTokenHashKeyring } from "./opaque-verifier.js";
import {
  npAgentPreviewSessionFingerprintV1,
  npVerifyAgentPreviewSessionFingerprintV1,
  npMintAgentPreviewSecretV1,
  npVerifyAgentPreviewSecretV1,
  npAgentPreviewOpaquePublicIdV1,
  npRequireAgentPreviewOrigin,
  npRequireAgentPreviewRenderOrigin,
  npSignAgentPreviewTokenV1,
  npVerifyAgentPreviewTokenV1,
  npAgentPreviewNonce,
  npAgentPreviewViewerPath,
  npAgentPreviewViewerCookie,
  npAgentPreviewRenderCookie,
  npAgentPreviewLaunchBridge,
  npAgentPreviewActivationPage,
  type NpAgentPreviewSigningKeyringV1,
  type NpAgentPreviewViewerClaimsV1,
} from "./preview-transport.js";

type Preview = typeof npAgentChangesetPreviews.$inferSelect;
type Launch = typeof npAgentPreviewViewerLaunches.$inferSelect;
type Capture = (typeof npAgentPreviewRenderSessions.$inferSelect)["capturePlan"][number];
export type NpAgentPreviewCapturePlanEntryV1 = Omit<
  Capture,
  "captureTicketDigest" | "captureTicketKeyId"
>;
export interface NpAgentPreviewAccessServiceOptionsV1 extends NpAgentAdminAdmissionOptionsV1 {
  changesets: Pick<NpAgentChangeSetServiceV1, "withPreviewViewer" | "withPreviewAuthority">;
  previewOrigin: string;
  servedOrigins: readonly string[];
  siteOrigin: (siteId: string) => Promise<string>;
  signingKeys: NpAgentPreviewSigningKeyringV1;
  sessionKeys: NpAgentTokenHashKeyring;
  exchangeKeys: NpAgentTokenHashKeyring;
  renderCookieKeys: NpAgentTokenHashKeyring;
  captureKeys: NpAgentTokenHashKeyring;
  /** Server-owned frozen-contract capture plan. No request may supply routes or viewport choices. */
  capturePlan?: (preview: Preview) => readonly NpAgentPreviewCapturePlanEntryV1[];
}
function unavailable(): never {
  throw new NpAgentGatewayError("NOT_FOUND", 404, "Preview is unavailable.");
}
function expired(): never {
  throw new NpAgentGatewayError("PREVIEW_LAUNCH_EXPIRED", 404, "Preview launch is unavailable.");
}
function same(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function activeState(value: string): boolean {
  return value === "exchange_pending" || value === "active";
}
function cloneKeys(keys: NpAgentTokenHashKeyring): NpAgentTokenHashKeyring {
  const entries = Object.entries(keys.previous ?? {});
  const result = {
    active: { id: keys.active.id, key: new Uint8Array(keys.active.key) },
    previous: Object.fromEntries(entries.map(([id, key]) => [id, new Uint8Array(key)])),
  };
  for (const [id, key] of [
    [result.active.id, result.active.key] as const,
    ...Object.entries(result.previous),
  ]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id) || key.byteLength !== 32)
      throw new Error("Invalid preview keyring.");
  }
  if (entries.some(([id]) => id === result.active.id)) throw new Error("Invalid preview keyring.");
  return result;
}
function requireDistinctKeys(keyrings: readonly NpAgentTokenHashKeyring[]): void {
  const seen = new Set<string>();
  for (const keyring of keyrings)
    for (const key of [keyring.active.key, ...Object.values(keyring.previous ?? {})]) {
      const encoded = Buffer.from(key).toString("hex");
      if (seen.has(encoded)) throw new Error("Preview HMAC purposes require distinct keys.");
      seen.add(encoded);
    }
}
function parseCookie(header: string, name: string): string | null {
  if (header.length > 32_768) return null;
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

export interface NpAgentPreviewPreparedRenderV1 {
  token: string;
  renderSessionId: string;
  bootstrapInput: {
    schemaVersion: string;
    renderAttemptId: string;
    tickets: { ordinal: number; ticketDigest: string; ticketKeyId: string }[];
  };
  captures: (NpAgentPreviewCapturePlanEntryV1 & { ticket: string })[];
}
export interface NpAgentPreviewRenderLeaseV1 {
  readonly expiresAt: string;
  use<T>(consume: (prepared: NpAgentPreviewPreparedRenderV1) => Promise<T>): Promise<T>;
  dispose(): void;
}
/** Server-only one-time transfer, using the existing plaintext lease lifecycle. */
class PreviewRenderLease implements NpAgentPreviewRenderLeaseV1 {
  #bytes: Buffer;
  #used = false;
  readonly expiresAt: string;
  constructor(
    prepared: NpAgentPreviewPreparedRenderV1,
    expiresAt: Date,
    private readonly now: () => Date,
  ) {
    this.#bytes = Buffer.from(serializeAgentCanonicalJson(prepared));
    this.expiresAt = expiresAt.toISOString();
  }
  toJSON(): never {
    throw new Error("Preview render leases cannot be serialized.");
  }
  dispose(): void {
    this.#used = true;
    this.#bytes.fill(0);
  }
  async use<T>(consume: (prepared: NpAgentPreviewPreparedRenderV1) => Promise<T>): Promise<T> {
    if (this.#used || this.now().getTime() >= Date.parse(this.expiresAt)) {
      this.dispose();
      unavailable();
    }
    const prepared = JSON.parse(this.#bytes.toString("utf8")) as NpAgentPreviewPreparedRenderV1;
    this.dispose();
    try {
      return await consume(prepared);
    } finally {
      // JavaScript cannot erase copies made by the host; clear every reference owned by this lease.
      prepared.token = "";
      for (const capture of prepared.captures) capture.ticket = "";
      prepared.captures.length = 0;
      prepared.bootstrapInput.tickets.length = 0;
    }
  }
}

export interface NpAgentPreviewAccessServiceV1 {
  previewOrigin: string;
  launch(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    changeSetId: string;
    previewId: string;
    command: unknown;
  }): Promise<{ html: string; headers: Record<string, string> }>;
  activate(input: {
    exchange: string;
    origin: string;
  }): Promise<{ html: string; headers: Record<string, string> }>;
  view<T>(input: {
    previewId: string;
    launchId: string;
    encodedRoute: string;
    cookie: string;
    render: (context: {
      preview: Preview;
      route: string;
      locale: string | null;
      viewer: { userId: string; sessionId: string };
    }) => Promise<T>;
  }): Promise<T>;
  prepareRender(input: {
    siteId: string;
    previewId: string;
    origin: string;
  }): Promise<NpAgentPreviewRenderLeaseV1>;
  bootstrapRender(input: {
    token: string;
    origin: string;
    body: unknown;
  }): Promise<{ cookie: string }>;
  consumeCapture(input: {
    renderSessionId: string;
    ordinal: number;
    cookie: string;
    ticket: string;
  }): Promise<{ preview: Preview; capture: NpAgentPreviewCapturePlanEntryV1 }>;
}

export function createAgentPreviewAccessServiceV1(
  options: NpAgentPreviewAccessServiceOptionsV1,
): NpAgentPreviewAccessServiceV1 {
  if (options.servedOrigins.length === 0)
    throw new Error("Preview requires the complete served-origin inventory.");
  const servedOrigins = Object.freeze([...options.servedOrigins]);
  const previewOrigin = npRequireAgentPreviewOrigin(options.previewOrigin, servedOrigins);
  const signingKeys = {
    active: { ...options.signingKeys.active },
    previous: { ...options.signingKeys.previous },
  };
  const sessionKeys = cloneKeys(options.sessionKeys);
  const exchangeKeys = cloneKeys(options.exchangeKeys);
  const renderCookieKeys = cloneKeys(options.renderCookieKeys);
  const captureKeys = cloneKeys(options.captureKeys);
  requireDistinctKeys([sessionKeys, exchangeKeys, renderCookieKeys, captureKeys]);
  const now = options.now ?? (() => new Date());
  const admit = createAgentAdminAdmissionV1(options);
  const viewerAuthority = options.changesets.withPreviewViewer;
  const renderAuthority = options.changesets.withPreviewAuthority;
  function requireLivePreview(preview: Preview, ready: boolean): void {
    if (
      (ready && preview.state !== "ready") ||
      (!ready && !["queued", "rendering"].includes(preview.state)) ||
      (preview.expiresAt && preview.expiresAt.getTime() <= now().getTime())
    )
      unavailable();
  }
  async function validLaunch(
    row: Launch,
    preview: Preview,
    authorityDigest: string,
  ): Promise<void> {
    if (
      row.previewId !== preview.id ||
      row.siteId !== preview.siteId ||
      row.exp * 1000 <= now().getTime() ||
      row.allowedRoutesDigest !== preview.allowedRoutesDigest ||
      !same(row.siteAuthorizationDigest, authorityDigest) ||
      !same(
        await npDigestAgentStaffSiteAuthorizationCanonical(row.siteAuthorizationBody),
        row.siteAuthorizationDigest,
      ) ||
      !npVerifyAgentPreviewSessionFingerprintV1({
        siteId: row.siteId,
        userId: row.staffUserId,
        sessionId: row.staffSessionId,
        fingerprint: row.sessionFingerprint,
        keyring: sessionKeys,
      })
    )
      expired();
  }
  function capturePlan(preview: Preview): NpAgentPreviewCapturePlanEntryV1[] {
    const plan = options.capturePlan?.(preview);
    if (!plan || plan.length < 1 || plan.length > 20) unavailable();
    const cloned = JSON.parse(
      serializeAgentCanonicalJson(plan),
    ) as NpAgentPreviewCapturePlanEntryV1[];
    for (const [index, item] of cloned.entries()) {
      if (
        Object.keys(item).sort().join(",") !==
          [
            "ordinal",
            "route",
            "locale",
            "audience",
            "viewportName",
            "width",
            "height",
            "deviceScaleFactor",
          ]
            .sort()
            .join(",") ||
        item.ordinal !== index + 1 ||
        item.audience !== "public" ||
        !["desktop", "mobile"].includes(item.viewportName) ||
        !Number.isInteger(item.width) ||
        item.width < 1 ||
        item.width > 8192 ||
        !Number.isInteger(item.height) ||
        item.height < 1 ||
        item.height > 8192 ||
        ![1, 2].includes(item.deviceScaleFactor) ||
        !preview.allowedRoutes.some(
          (route) =>
            route.route === item.route &&
            route.locale === item.locale &&
            route.audience === item.audience,
        )
      )
        unavailable();
      canonicalBodyPreviewRoute(item.route, "route");
    }
    const targets = new Set(
      cloned.map((item) =>
        serializeAgentCanonicalJson([item.route, item.locale, item.viewportName]),
      ),
    );
    if (targets.size !== cloned.length) unavailable();
    return cloned;
  }
  return {
    previewOrigin,
    async launch(input: {
      siteId: string;
      actor: NpAgentAdminActorV1;
      changeSetId: string;
      previewId: string;
      command: unknown;
    }) {
      const command = npRequireAgentChangeSetPreviewLaunchRequestV1(input.command);
      const result = await admit({
        siteId: input.siteId,
        actor: input.actor,
        operationId: "agents.changesets.preview_launch",
        parentTargetId: input.changeSetId,
        targetId: input.previewId,
        command,
        mutate: ({ db, invocationId }) =>
          viewerAuthority({
            db,
            siteId: input.siteId,
            userId: input.actor.user.id,
            sessionId: input.actor.sessionId,
            previewId: input.previewId,
            changeSetId: input.changeSetId,
            requireReady: true,
            mutate: async (tx, preview, authority) => {
              requireLivePreview(preview, true);
              const [changeset] = await tx
                .select({ rowVersion: npAgentChangesets.draftVersion })
                .from(npAgentChangesets)
                .where(
                  and(
                    eq(npAgentChangesets.siteId, input.siteId),
                    eq(npAgentChangesets.id, input.changeSetId),
                  ),
                )
                .limit(1);
              if (
                !changeset ||
                changeset.rowVersion !== command.expectedVersion ||
                preview.planHash !== command.expectedPlanHash
              )
                throw new NpAgentGatewayError(
                  "PRECONDITION_FAILED",
                  409,
                  "Preview precondition changed.",
                );
              if (
                !preview.allowedRoutes.some(
                  (route) => route.route === command.route && route.audience === "public",
                )
              )
                unavailable();
              const current = now();
              const rows = await tx
                .select()
                .from(npAgentPreviewViewerLaunches)
                .where(
                  and(
                    eq(npAgentPreviewViewerLaunches.siteId, input.siteId),
                    eq(npAgentPreviewViewerLaunches.previewId, preview.id),
                    inArray(npAgentPreviewViewerLaunches.state, ["exchange_pending", "active"]),
                  ),
                )
                .limit(21);
              if (rows.length > 20) unavailable();
              const [last] = await tx
                .select({ generation: npAgentPreviewViewerLaunches.generation })
                .from(npAgentPreviewViewerLaunches)
                .where(
                  and(
                    eq(npAgentPreviewViewerLaunches.previewId, preview.id),
                    eq(npAgentPreviewViewerLaunches.staffSessionId, input.actor.sessionId),
                  ),
                )
                .orderBy(desc(npAgentPreviewViewerLaunches.generation))
                .limit(1);
              const live: Launch[] = [];
              for (const row of rows)
                if (activeState(row.state)) {
                  if (
                    row.exp * 1000 <= current.getTime() ||
                    (row.state === "exchange_pending" &&
                      row.exchangeExpiresAt.getTime() <= current.getTime())
                  )
                    await tx
                      .update(npAgentPreviewViewerLaunches)
                      .set({
                        state: "expired",
                        expiredAt: current,
                        terminalReason: "PREVIEW_INVALIDATED",
                      })
                      .where(eq(npAgentPreviewViewerLaunches.id, row.id));
                  else if (row.staffSessionId === input.actor.sessionId)
                    await tx
                      .update(npAgentPreviewViewerLaunches)
                      .set({
                        state: "superseded",
                        supersededAt: current,
                        terminalReason: "REPLACED",
                      })
                      .where(eq(npAgentPreviewViewerLaunches.id, row.id));
                  else live.push(row);
                }
              if (live.length >= 20)
                throw new NpAgentGatewayError(
                  "RATE_LIMITED",
                  429,
                  "Preview viewer limit reached.",
                  {
                    reasonCode: "PREVIEW_VIEWER_LIMIT",
                    retryAfterSeconds: Math.max(
                      1,
                      Math.ceil(
                        (Math.min(
                          ...live.map((row) =>
                            Math.min(
                              row.exp * 1000,
                              row.state === "exchange_pending"
                                ? row.exchangeExpiresAt.getTime()
                                : Infinity,
                            ),
                          ),
                        ) -
                          current.getTime()) /
                          1000,
                      ),
                    ),
                  },
                );
              const generation = (last?.generation ?? 0) + 1;
              const id = randomUUID();
              const exchange = npMintAgentPreviewSecretV1(
                { purpose: "launch", siteId: input.siteId, previewId: preview.id, launchId: id },
                exchangeKeys,
              );
              const iat = Math.floor(current.getTime() / 1000);
              const exp = Math.min(
                iat + 300,
                Math.floor((preview.expiresAt?.getTime() ?? Infinity) / 1000),
              );
              if (exp <= iat) unavailable();
              const [invocation] = await tx
                .select({ requestHash: npAgentInvocations.requestHash })
                .from(npAgentInvocations)
                .where(eq(npAgentInvocations.id, invocationId))
                .limit(1);
              if (!invocation) unavailable();
              await tx.insert(npAgentPreviewViewerLaunches).values({
                id,
                siteId: input.siteId,
                previewId: preview.id,
                staffUserId: input.actor.user.id,
                staffSessionId: input.actor.sessionId,
                sessionFingerprint: npAgentPreviewSessionFingerprintV1({
                  siteId: input.siteId,
                  userId: input.actor.user.id,
                  sessionId: input.actor.sessionId,
                  keyring: sessionKeys,
                }),
                sessionFingerprintKeyId: sessionKeys.active.id,
                generation,
                admittingInvocationId: invocationId,
                idempotencyKey: command.idempotencyKey,
                requestHash: invocation.requestHash,
                signingKid: signingKeys.active.id,
                allowedRoutesDigest: preview.allowedRoutesDigest,
                siteAuthorizationBody: authority,
                siteAuthorizationDigest:
                  await npDigestAgentStaffSiteAuthorizationCanonical(authority),
                iat,
                exp,
                launchPath: npAgentPreviewViewerPath({
                  previewId: preview.id,
                  launchId: id,
                  route: command.route,
                }),
                exchangeVerifier: exchange.verifier,
                exchangeKeyId: exchange.keyId,
                exchangeExpiresAt: new Date(Math.min(current.getTime() + 30_000, exp * 1000)),
                oneTimeValueIssued: true,
                state: "exchange_pending",
                createdAt: current,
              });
              return { resourceId: id, output: { launchId: id }, oneTimeValue: exchange.value };
            },
          }),
      });
      if (!result.oneTimeValue) unavailable();
      return npAgentPreviewLaunchBridge({
        previewOrigin,
        exchange: result.oneTimeValue,
        nonce: npAgentPreviewNonce(),
      });
    },
    async activate(input: { exchange: string; origin: string }) {
      const id = npAgentPreviewOpaquePublicIdV1(input.exchange, "launch");
      if (!id) unavailable();
      const [found] = await getDb()
        .select()
        .from(npAgentPreviewViewerLaunches)
        .where(eq(npAgentPreviewViewerLaunches.id, id))
        .limit(1);
      if (!found) unavailable();
      const siteOrigin = await options.siteOrigin(found.siteId);
      if (input.origin !== siteOrigin || !servedOrigins.includes(siteOrigin)) unavailable();
      return viewerAuthority({
        siteId: found.siteId,
        userId: found.staffUserId,
        sessionId: found.staffSessionId,
        previewId: found.previewId,
        requireReady: true,
        mutate: async (db, preview, authority) => {
          requireLivePreview(preview, true);
          const [row] = await db
            .select()
            .from(npAgentPreviewViewerLaunches)
            .where(eq(npAgentPreviewViewerLaunches.id, id))
            .for("update");
          if (
            !row ||
            row.state !== "exchange_pending" ||
            row.exchangeExpiresAt.getTime() <= now().getTime() ||
            row.signingKid !== signingKeys.active.id ||
            !npVerifyAgentPreviewSecretV1(
              { purpose: "launch", siteId: row.siteId, previewId: row.previewId, launchId: id },
              input.exchange,
              row.exchangeVerifier,
              exchangeKeys,
            )
          )
            unavailable();
          await validLaunch(
            row,
            preview,
            await npDigestAgentStaffSiteAuthorizationCanonical(authority),
          );
          const route = decodeURIComponent(
            row.launchPath.slice(row.launchPath.lastIndexOf("/") + 1),
          );
          if (
            npAgentPreviewViewerPath({ previewId: preview.id, launchId: id, route }) !==
              row.launchPath ||
            !preview.allowedRoutes.some(
              (entry) => entry.route === route && entry.audience === "public",
            )
          )
            unavailable();
          const claims: NpAgentPreviewViewerClaimsV1 = {
            schemaVersion: "np.agent-preview-token.v1",
            intent: "viewer",
            issuer: previewOrigin,
            audience: `urn:nexpress:preview:${row.siteId}`,
            siteId: row.siteId,
            changeSetId: preview.changesetId,
            previewId: preview.id,
            planHash: preview.planHash,
            allowedRoutesDigest: row.allowedRoutesDigest,
            launchGeneration: row.generation,
            launchId: id,
            viewer: {
              kind: "staff",
              userId: row.staffUserId,
              sessionFingerprint: row.sessionFingerprint,
              userTokenVersion: authority.userTokenVersion,
              siteAuthorizationDigest: row.siteAuthorizationDigest,
            },
            iat: row.iat,
            exp: row.exp,
          };
          const token = npSignAgentPreviewTokenV1(claims, signingKeys);
          const current = now();
          if (row.exchangeExpiresAt.getTime() <= current.getTime()) unavailable();
          const response = npAgentPreviewActivationPage({
            previewId: preview.id,
            launchId: id,
            route,
            nonce: npAgentPreviewNonce(),
          });
          response.headers["set-cookie"] = npAgentPreviewViewerCookie({
            previewId: preview.id,
            token,
            now: current,
            expiresAt: new Date(row.exp * 1000),
          });
          await db
            .update(npAgentPreviewViewerLaunches)
            .set({ state: "active", activatedAt: current, exchangeConsumedAt: current })
            .where(
              and(
                eq(npAgentPreviewViewerLaunches.id, id),
                eq(npAgentPreviewViewerLaunches.state, "exchange_pending"),
              ),
            );
          return response;
        },
      });
    },
    async view<T>(input: {
      previewId: string;
      launchId: string;
      encodedRoute: string;
      cookie: string;
      render: (context: {
        preview: Preview;
        route: string;
        locale: string | null;
        viewer: { userId: string; sessionId: string };
      }) => Promise<T>;
    }): Promise<T> {
      canonicalBodyUuid(input.previewId, "previewId");
      canonicalBodyUuid(input.launchId, "launchId");
      const token = parseCookie(
        input.cookie,
        `__Secure-np-preview-${input.previewId.replaceAll("-", "")}`,
      );
      if (!token) expired();
      const claims = npVerifyAgentPreviewTokenV1({
        token,
        intent: "viewer",
        issuer: previewOrigin,
        keyring: signingKeys,
        now: now(),
      });
      if (
        !claims ||
        claims.intent !== "viewer" ||
        claims.previewId !== input.previewId ||
        claims.launchId !== input.launchId
      )
        expired();
      const route = decodeURIComponent(input.encodedRoute);
      if (encodeURIComponent(route) !== input.encodedRoute) expired();
      canonicalBodyPreviewRoute(route, "route");
      const authorize = async () =>
        viewerAuthority({
          siteId: claims.siteId,
          userId: claims.viewer.userId,
          sessionId:
            (
              await getDb()
                .select({ sessionId: npAgentPreviewViewerLaunches.staffSessionId })
                .from(npAgentPreviewViewerLaunches)
                .where(
                  and(
                    eq(npAgentPreviewViewerLaunches.id, input.launchId),
                    eq(npAgentPreviewViewerLaunches.siteId, claims.siteId),
                  ),
                )
                .limit(1)
            )[0]?.sessionId ?? "",
          previewId: input.previewId,
          changeSetId: claims.changeSetId,
          requireReady: true,
          mutate: async (db, preview, authority) => {
            requireLivePreview(preview, true);
            const [row] = await db
              .select()
              .from(npAgentPreviewViewerLaunches)
              .where(eq(npAgentPreviewViewerLaunches.id, input.launchId))
              .for("update");
            if (
              !row ||
              row.state !== "active" ||
              row.staffUserId !== claims.viewer.userId ||
              row.generation !== claims.launchGeneration ||
              row.iat !== claims.iat ||
              row.exp !== claims.exp ||
              preview.planHash !== claims.planHash ||
              preview.allowedRoutesDigest !== claims.allowedRoutesDigest ||
              authority.userTokenVersion !== claims.viewer.userTokenVersion ||
              !same(row.sessionFingerprint, claims.viewer.sessionFingerprint) ||
              !same(row.siteAuthorizationDigest, claims.viewer.siteAuthorizationDigest)
            )
              expired();
            if (
              !npVerifyAgentPreviewTokenV1({
                token,
                intent: "viewer",
                issuer: previewOrigin,
                keyring: signingKeys,
                now: now(),
                expectedKid: row.signingKid,
              })
            )
              expired();
            await validLaunch(
              row,
              preview,
              await npDigestAgentStaffSiteAuthorizationCanonical(authority),
            );
            const matches = preview.allowedRoutes.filter(
              (entry) => entry.route === route && entry.audience === "public",
            );
            if (matches.length !== 1) expired();
            return {
              preview,
              route,
              locale: matches[0].locale,
              viewer: { userId: row.staffUserId, sessionId: row.staffSessionId },
            };
          },
        });
      const authorized = await authorize();
      const output = await input.render(authorized);
      await authorize();
      return output;
    },
    async prepareRender(input: { siteId: string; previewId: string; origin: string }) {
      const origin = npRequireAgentPreviewRenderOrigin(input.origin);
      return renderAuthority({
        siteId: input.siteId,
        previewId: input.previewId,
        mutate: async (db, preview) => {
          requireLivePreview(preview, false);
          if (preview.renderBootstrapJti) unavailable();
          const plan = capturePlan(preview);
          const current = now();
          const iat = Math.floor(current.getTime() / 1000);
          const exp = Math.min(
            iat + 120,
            Math.floor((preview.expiresAt?.getTime() ?? Infinity) / 1000),
          );
          if (exp <= iat) unavailable();
          const renderAttemptId = randomUUID();
          const renderSessionId = randomUUID();
          const jti = randomUUID();
          const tickets = plan.map((entry) => ({
            ordinal: entry.ordinal,
            ...npMintAgentPreviewSecretV1(
              {
                purpose: "capture",
                siteId: preview.siteId,
                previewId: preview.id,
                renderSessionId,
                renderAttemptId,
                ordinal: entry.ordinal,
              },
              captureKeys,
            ),
          }));
          await db
            .update(npAgentChangesetPreviews)
            .set({
              renderBootstrapJti: jti,
              renderAttemptId,
              renderSessionId,
              renderBootstrapIssuedAt: new Date(iat * 1000),
              renderBootstrapExpiresAt: new Date(exp * 1000),
            })
            .where(eq(npAgentChangesetPreviews.id, preview.id));
          const token = npSignAgentPreviewTokenV1(
            {
              schemaVersion: "np.agent-preview-render-token.v1",
              intent: "render",
              issuer: origin,
              audience: "urn:nexpress:preview-render",
              siteId: preview.siteId,
              previewId: preview.id,
              generation: preview.generation,
              planHash: preview.planHash,
              allowedRoutesDigest: preview.allowedRoutesDigest,
              previewContractFingerprint: preview.previewContractFingerprint,
              renderAttemptId,
              renderSessionId,
              jti,
              iat,
              exp,
            },
            signingKeys,
          );
          return new PreviewRenderLease(
            {
              token,
              renderSessionId,
              bootstrapInput: {
                schemaVersion: "np.agent-preview-render-bootstrap-input.v1",
                renderAttemptId,
                tickets: tickets.map((ticket) => ({
                  ordinal: ticket.ordinal,
                  ticketDigest: ticket.verifier,
                  ticketKeyId: ticket.keyId,
                })),
              },
              captures: tickets.map((ticket, index) => ({ ...plan[index], ticket: ticket.value })),
            },
            new Date(exp * 1000),
            now,
          );
        },
      });
    },
    async bootstrapRender(input: { token: string; origin: string; body: unknown }) {
      const origin = npRequireAgentPreviewRenderOrigin(input.origin);
      const claims = npVerifyAgentPreviewTokenV1({
        token: input.token,
        intent: "render",
        issuer: origin,
        keyring: signingKeys,
        now: now(),
      });
      if (!claims || claims.intent !== "render") unavailable();
      const body = JSON.parse(serializeAgentCanonicalJson(input.body)) as {
        schemaVersion: string;
        renderAttemptId: string;
        tickets: { ordinal: number; ticketDigest: string; ticketKeyId: string }[];
      };
      if (
        Object.keys(body).sort().join(",") !== "renderAttemptId,schemaVersion,tickets" ||
        body.schemaVersion !== "np.agent-preview-render-bootstrap-input.v1" ||
        body.renderAttemptId !== claims.renderAttemptId ||
        !Array.isArray(body.tickets) ||
        body.tickets.length > 20
      )
        unavailable();
      return renderAuthority({
        siteId: claims.siteId,
        previewId: claims.previewId,
        mutate: async (db, preview) => {
          requireLivePreview(preview, false);
          if (
            preview.renderBootstrapJti !== claims.jti ||
            preview.renderAttemptId !== claims.renderAttemptId ||
            preview.renderSessionId !== claims.renderSessionId ||
            preview.renderBootstrapConsumedAt ||
            preview.renderBootstrapIssuedAt?.getTime() !== claims.iat * 1000 ||
            preview.renderBootstrapExpiresAt?.getTime() !== claims.exp * 1000 ||
            claims.exp * 1000 <= now().getTime() ||
            preview.generation !== claims.generation ||
            preview.planHash !== claims.planHash ||
            preview.allowedRoutesDigest !== claims.allowedRoutesDigest ||
            preview.previewContractFingerprint !== claims.previewContractFingerprint
          )
            unavailable();
          const plan = capturePlan(preview);
          if (body.tickets.length !== plan.length) unavailable();
          const capture = plan.map((entry, index) => {
            const ticket = body.tickets[index];
            if (
              Object.keys(ticket).sort().join(",") !== "ordinal,ticketDigest,ticketKeyId" ||
              ticket.ordinal !== entry.ordinal ||
              !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(ticket.ticketKeyId) ||
              !new RegExp(
                `^ctv1:hmac-sha256:${ticket.ticketKeyId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:[A-Za-z0-9_-]{43}$`,
                "u",
              ).test(ticket.ticketDigest) ||
              !(
                ticket.ticketKeyId === captureKeys.active.id ||
                captureKeys.previous?.[ticket.ticketKeyId]
              )
            )
              unavailable();
            return {
              ...entry,
              captureTicketDigest: ticket.ticketDigest,
              captureTicketKeyId: ticket.ticketKeyId,
            };
          });
          const cookie = npMintAgentPreviewSecretV1(
            {
              purpose: "render-cookie",
              siteId: preview.siteId,
              previewId: preview.id,
              renderSessionId: claims.renderSessionId,
            },
            renderCookieKeys,
          );
          const current = now();
          await db.insert(npAgentPreviewRenderSessions).values({
            id: claims.renderSessionId,
            siteId: preview.siteId,
            previewId: preview.id,
            generation: preview.generation,
            planHash: preview.planHash,
            renderAttemptId: claims.renderAttemptId,
            allowedRoutesDigest: preview.allowedRoutesDigest,
            previewContractFingerprint: preview.previewContractFingerprint,
            state: "active",
            cookieVerifier: cookie.verifier,
            cookieVerifierKeyId: cookie.keyId,
            issuedAt: current,
            expiresAt: new Date(claims.exp * 1000),
            capturePlan: capture,
            consumedOrdinals: capture.map(() => false),
          });
          await db
            .update(npAgentChangesetPreviews)
            .set({ renderBootstrapConsumedAt: current })
            .where(eq(npAgentChangesetPreviews.id, preview.id));
          return {
            cookie: npAgentPreviewRenderCookie({
              renderSessionId: claims.renderSessionId,
              token: cookie.value,
              expiresAt: new Date(claims.exp * 1000),
              now: current,
            }),
          };
        },
      });
    },
    async consumeCapture(input: {
      renderSessionId: string;
      ordinal: number;
      cookie: string;
      ticket: string;
    }) {
      canonicalBodyUuid(input.renderSessionId, "renderSessionId");
      const token = parseCookie(input.cookie, "np-preview-render");
      if (!token) unavailable();
      const [found] = await getDb()
        .select()
        .from(npAgentPreviewRenderSessions)
        .where(eq(npAgentPreviewRenderSessions.id, input.renderSessionId))
        .limit(1);
      if (!found) unavailable();
      return renderAuthority({
        siteId: found.siteId,
        previewId: found.previewId,
        mutate: async (db, preview) => {
          requireLivePreview(preview, false);
          const [row] = await db
            .select()
            .from(npAgentPreviewRenderSessions)
            .where(eq(npAgentPreviewRenderSessions.id, input.renderSessionId))
            .for("update");
          if (
            !row ||
            row.state !== "active" ||
            row.expiresAt.getTime() <= now().getTime() ||
            row.planHash !== preview.planHash ||
            row.generation !== preview.generation ||
            row.allowedRoutesDigest !== preview.allowedRoutesDigest ||
            row.previewContractFingerprint !== preview.previewContractFingerprint ||
            !npVerifyAgentPreviewSecretV1(
              {
                purpose: "render-cookie",
                siteId: row.siteId,
                previewId: row.previewId,
                renderSessionId: row.id,
              },
              token,
              row.cookieVerifier,
              renderCookieKeys,
            )
          )
            unavailable();
          const storedPlan = row.capturePlan.map(
            ({ captureTicketDigest: _digest, captureTicketKeyId: _keyId, ...entry }) => entry,
          );
          if (
            serializeAgentCanonicalJson(storedPlan) !==
            serializeAgentCanonicalJson(capturePlan(preview))
          )
            unavailable();
          const index = row.capturePlan.findIndex((entry) => entry.ordinal === input.ordinal);
          if (
            index < 0 ||
            row.consumedOrdinals[index] !== false ||
            row.consumedOrdinals.length !== row.capturePlan.length
          )
            unavailable();
          const capture = row.capturePlan[index];
          if (
            !npVerifyAgentPreviewSecretV1(
              {
                purpose: "capture",
                siteId: row.siteId,
                previewId: row.previewId,
                renderSessionId: row.id,
                renderAttemptId: row.renderAttemptId,
                ordinal: input.ordinal,
              },
              input.ticket,
              capture.captureTicketDigest,
              captureKeys,
            )
          )
            unavailable();
          const consumed = row.consumedOrdinals.map((value, offset) => offset === index || value);
          const completed = consumed.every(Boolean);
          await db
            .update(npAgentPreviewRenderSessions)
            .set({
              consumedOrdinals: consumed,
              ...(completed ? { state: "completed", closedAt: now() } : {}),
            })
            .where(eq(npAgentPreviewRenderSessions.id, row.id));
          // This transaction commits the one-time ticket before any renderer produces HTML.
          return {
            preview,
            capture: {
              ordinal: capture.ordinal,
              route: capture.route,
              locale: capture.locale,
              audience: capture.audience,
              viewportName: capture.viewportName,
              width: capture.width,
              height: capture.height,
              deviceScaleFactor: capture.deviceScaleFactor,
            },
          };
        },
      });
    },
  };
}
