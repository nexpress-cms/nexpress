import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createSite,
  grantSiteMembership,
  npAgentInvocations,
  npAgentPrincipals,
  npAgentServiceTokens,
  npAuditEvents,
  npSessions,
  npUsers,
} from "@nexpress/core";

// eslint-disable-next-line import-x/no-relative-packages
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/index.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const siteId = "agent-lifecycle";
const gatewaySettings = {
  schemaVersion: "np.agent-gateway-settings.v1" as const,
  stdio: "approved-execute" as const,
  mcpHttp: "approved-execute" as const,
  agentHttp: "approved-execute" as const,
};

describe.skipIf(skipIfNoTestDb())("Agent Gateway principal and service-token lifecycle", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it.each([
    "authenticate",
    "rotate",
    "authenticate-after-revocation",
    "authenticate-after-expiry",
    "authenticate-after-overlap-expiry",
    "authenticate-after-exposure-expiry",
  ] as const)(
    "serializes %s with a principal-first authority recheck without deadlocking",
    async (operation) => {
      const seeded = await seedUser({ role: "admin" });
      await createSite({ id: siteId, name: "Agent locking" });
      await grantSiteMembership(siteId, seeded.userId, "admin");
      const db = await getTestDb();
      const [[user], [session]] = await Promise.all([
        db.select().from(npUsers).where(eq(npUsers.id, seeded.userId)).limit(1),
        db.select().from(npSessions).where(eq(npSessions.userId, seeded.userId)).limit(1),
      ]);
      if (!user || !session) throw new Error("Missing staff fixture");
      const actor = { user, sessionId: session.id };
      let clock = new Date();
      const expiresAt = new Date(clock.getTime() + 86_400_000);
      let expireOnExposure = false;
      const service = createAgentGatewayServiceV1({
        tokenHashKeyring: {
          active: { id: "agent-token-hash-v1", key: new Uint8Array(32).fill(9) },
        },
        environment: "production",
        deploymentGatewaySettings: gatewaySettings,
        resolveSiteGatewaySettings: () => {
          if (expireOnExposure) clock = expiresAt;
          return gatewaySettings;
        },
        reauthentication: { verify: () => true },
        now: () => clock,
      });
      const principal = await service.executeAdmin({
        siteId,
        actor,
        operationId: "agents.gateway.principals.create",
        targetId: null,
        command: {
          idempotencyKey: "agent:locking:principal",
          name: "Locking fixture",
          description: null,
          scopes: ["site:read"],
        },
      });
      const token = await service.executeAdmin({
        siteId,
        actor,
        operationId: "agents.gateway.principal_tokens.create",
        targetId: principal.resourceId,
        command: {
          idempotencyKey: "agent:locking:token",
          expectedVersion: 1,
          name: "Locking token",
          scopes: ["site:read"],
          transport: "stdio",
          exposure: "read",
          expiresAt: expiresAt.toISOString(),
        },
      });
      if (operation === "authenticate-after-overlap-expiry") {
        await service.executeAdmin({
          siteId,
          actor,
          operationId: "agents.gateway.principal_tokens.rotate",
          parentTargetId: principal.resourceId,
          targetId: token.resourceId,
          command: {
            idempotencyKey: "agent:locking:prepare-overlap",
            expectedVersion: 1,
            overlapSeconds: 900,
          },
        });
      }
      expireOnExposure = operation === "authenticate-after-exposure-expiry";

      let markPrincipalLocked!: (pid: number) => void;
      const principalLocked = new Promise<number>((resolve) => {
        markPrincipalLocked = resolve;
      });
      let releasePrincipalHolder!: () => void;
      const acquireToken = new Promise<void>((resolve) => {
        releasePrincipalHolder = resolve;
      });
      const authorityRecheck = db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        await tx
          .select()
          .from(npAgentPrincipals)
          .where(eq(npAgentPrincipals.id, principal.resourceId))
          .for("update");
        const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        markPrincipalLocked(backend.rows[0]!.pid);
        await acquireToken;
        // Admission and principal revocation both acquire locks in this order.
        await tx
          .select()
          .from(npAgentServiceTokens)
          .where(eq(npAgentServiceTokens.id, token.resourceId))
          .for("update");
        if (operation === "authenticate-after-revocation") {
          await tx
            .update(npAgentServiceTokens)
            .set({
              status: "revoked",
              revokedAt: new Date(),
              rowVersion: sql`${npAgentServiceTokens.rowVersion} + 1`,
            })
            .where(eq(npAgentServiceTokens.id, token.resourceId));
        }
      });
      void authorityRecheck.catch(() => markPrincipalLocked(-1));
      const holderPid = await principalLocked;
      expect(holderPid).toBeGreaterThan(0);
      const concurrent =
        operation !== "rotate"
          ? service.authenticateServiceToken({
              siteId,
              credential: token.oneTimeValue,
              transport: "stdio",
              audience: "urn:nexpress:agent-gateway:stdio",
            })
          : service.executeAdmin({
              siteId,
              actor,
              operationId: "agents.gateway.principal_tokens.rotate",
              parentTargetId: principal.resourceId,
              targetId: token.resourceId,
              command: {
                idempotencyKey: "agent:locking:rotate",
                expectedVersion: 1,
                overlapSeconds: 900,
              },
            });
      const completion = Promise.allSettled([authorityRecheck, concurrent]);
      try {
        await expect
          .poll(
            async () => {
              const blocked = await db.execute<{ waiting: boolean }>(sql`
            select exists (
              select 1 from pg_stat_activity
              where ${holderPid} = any(pg_blocking_pids(pid))
            ) as waiting
          `);
              return blocked.rows[0]?.waiting;
            },
            { timeout: 5_000 },
          )
          .toBe(true);
        if (operation === "authenticate-after-expiry") clock = expiresAt;
        if (operation === "authenticate-after-overlap-expiry") {
          clock = new Date(clock.getTime() + 900_000);
        }
      } finally {
        releasePrincipalHolder();
        await completion;
      }
      expect(
        (await completion).map((result) => {
          if (result.status === "fulfilled") return "fulfilled";
          const code = (result.reason as { cause?: { code?: string } }).cause?.code;
          if ((result.reason as { code?: string }).code === "SERVICE_TOKEN_INVALID") {
            return "invalid-credential";
          }
          return code === "40P01" ? "deadlock" : "rejected";
        }),
      ).toEqual([
        "fulfilled",
        operation.startsWith("authenticate-after-") ? "invalid-credential" : "fulfilled",
      ]);
      if (operation.startsWith("authenticate-after-")) {
        const [unused] = await db
          .select({ lastUsedAt: npAgentServiceTokens.lastUsedAt })
          .from(npAgentServiceTokens)
          .where(eq(npAgentServiceTokens.id, token.resourceId));
        expect(unused?.lastUsedAt).toBeNull();
      }
    },
  );

  it("keeps create, rotate, authenticate, authority loss, suspension, and revocation fail closed", async () => {
    const seeded = await seedUser({ role: "admin" });
    await createSite({ id: siteId, name: "Agent lifecycle" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const db = await getTestDb();
    const [[user], [session]] = await Promise.all([
      db.select().from(npUsers).where(eq(npUsers.id, seeded.userId)).limit(1),
      db
        .select({ id: npSessions.id })
        .from(npSessions)
        .where(eq(npSessions.userId, seeded.userId))
        .limit(1),
    ]);
    expect(user).toBeDefined();
    expect(session).toBeDefined();
    const actor = {
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        tokenVersion: user!.tokenVersion,
      },
      sessionId: session!.id,
    };
    const service = createAgentGatewayServiceV1({
      tokenHashKeyring: {
        active: { id: "agent-token-hash-v1", key: new Uint8Array(32).fill(9) },
      },
      environment: "production",
      deploymentGatewaySettings: gatewaySettings,
      resolveSiteGatewaySettings: () => gatewaySettings,
      resolveCanonicalSiteOrigin: () => "https://agent.example",
      reauthentication: { verify: () => true },
    });

    const principalCreate = {
      idempotencyKey: "agent:lifecycle:principal:create",
      name: "Editorial automation",
      description: "Integration fixture",
      scopes: ["content:read", "site:read"] as const,
    };
    const created = await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.create",
      targetId: null,
      command: principalCreate,
    });
    expect(created.replayed).toBe(false);
    expect(created.output).toMatchObject({ status: "active", rowVersion: 1, tokenVersion: 1 });
    const replayed = await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.create",
      targetId: null,
      command: principalCreate,
    });
    expect(replayed).toMatchObject({ replayed: true, resourceId: created.resourceId });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const tokenCommand = {
      idempotencyKey: "agent:lifecycle:token:create",
      expectedVersion: 1,
      name: "Editorial stdio",
      scopes: ["content:read", "site:read"] as const,
      transport: "stdio" as const,
      exposure: "read" as const,
      expiresAt,
    };
    const unverifiedService = createAgentGatewayServiceV1({
      tokenHashKeyring: {
        active: { id: "agent-token-hash-v1", key: new Uint8Array(32).fill(9) },
      },
      deploymentGatewaySettings: gatewaySettings,
      resolveSiteGatewaySettings: () => gatewaySettings,
    });
    await expect(
      unverifiedService.executeAdmin({
        siteId,
        actor,
        operationId: "agents.gateway.principal_tokens.create",
        targetId: created.resourceId,
        command: { ...tokenCommand, idempotencyKey: "agent:lifecycle:token:no-reauth" },
      }),
    ).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED", status: 403 });
    const token = await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principal_tokens.create",
      targetId: created.resourceId,
      command: tokenCommand,
    });
    expect(token.oneTimeValue).toMatch(/^npst1_/u);
    await expect(
      service.executeAdmin({
        siteId,
        actor,
        operationId: "agents.gateway.principal_tokens.create",
        targetId: created.resourceId,
        command: tokenCommand,
      }),
    ).rejects.toMatchObject({
      code: "ONE_TIME_VALUE_ALREADY_ISSUED",
      details: {
        resourceId: token.resourceId,
        recoveryOperationId: "agents.gateway.principal_tokens.rotate",
      },
    });

    const authenticated = await service.authenticateServiceToken({
      siteId,
      credential: token.oneTimeValue,
      transport: "stdio",
      audience: "urn:nexpress:agent-gateway:stdio",
    });
    expect(authenticated).toMatchObject({
      scopes: ["content:read", "site:read"],
      authorizationContext: { transport: "stdio", gatewayExposure: "read" },
    });
    await expect(
      service.authenticateStdioServiceToken({ credential: token.oneTimeValue }),
    ).resolves.toMatchObject({
      principal: { siteId },
      serviceToken: { siteId, transport: "stdio" },
      authorizationContext: {
        siteId,
        transport: "stdio",
        authorityRef: { audience: "urn:nexpress:agent-gateway:stdio" },
      },
    });

    const rotated = await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principal_tokens.rotate",
      parentTargetId: created.resourceId,
      targetId: token.resourceId,
      command: {
        idempotencyKey: "agent:lifecycle:token:rotate",
        expectedVersion: 1,
        overlapSeconds: 900,
      },
    });
    expect(rotated.oneTimeValue).toMatch(/^npst1_/u);
    await expect(
      service.authenticateServiceToken({
        siteId,
        credential: token.oneTimeValue,
        transport: "stdio",
        audience: "urn:nexpress:agent-gateway:stdio",
      }),
    ).resolves.toMatchObject({ serviceToken: { status: "overlap" } });

    const narrowed = await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.update",
      targetId: created.resourceId,
      command: {
        idempotencyKey: "agent:lifecycle:principal:narrow",
        expectedVersion: 2,
        name: "Editorial automation",
        description: null,
        scopes: ["site:read"],
      },
    });
    expect(narrowed.output).toMatchObject({ rowVersion: 3, tokenVersion: 2 });
    for (const credential of [token.oneTimeValue, rotated.oneTimeValue]) {
      await expect(
        service.authenticateServiceToken({
          siteId,
          credential,
          transport: "stdio",
          audience: "urn:nexpress:agent-gateway:stdio",
        }),
      ).rejects.toMatchObject({ code: "SERVICE_TOKEN_INVALID", status: 401 });
    }

    const replacement = await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principal_tokens.create",
      targetId: created.resourceId,
      command: {
        idempotencyKey: "agent:lifecycle:token:replacement",
        expectedVersion: 3,
        name: "Replacement stdio",
        scopes: ["site:read"],
        transport: "stdio",
        exposure: "read",
        expiresAt,
      },
    });
    await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.suspend",
      targetId: created.resourceId,
      command: {
        idempotencyKey: "agent:lifecycle:principal:suspend",
        expectedVersion: 4,
        reason: "Maintenance",
      },
    });
    await expect(
      service.authenticateServiceToken({
        siteId,
        credential: replacement.oneTimeValue,
        transport: "stdio",
        audience: "urn:nexpress:agent-gateway:stdio",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_TOKEN_INVALID" });
    await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.resume",
      targetId: created.resourceId,
      command: {
        idempotencyKey: "agent:lifecycle:principal:resume",
        expectedVersion: 5,
      },
    });
    await expect(
      service.authenticateServiceToken({
        siteId,
        credential: replacement.oneTimeValue,
        transport: "stdio",
        audience: "urn:nexpress:agent-gateway:stdio",
      }),
    ).resolves.toMatchObject({ principal: { status: "active" } });
    await service.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.revoke",
      targetId: created.resourceId,
      command: {
        idempotencyKey: "agent:lifecycle:principal:revoke",
        expectedVersion: 6,
        reason: "Decommissioned",
      },
    });
    await expect(
      service.authenticateServiceToken({
        siteId,
        credential: replacement.oneTimeValue,
        transport: "stdio",
        audience: "urn:nexpress:agent-gateway:stdio",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_TOKEN_INVALID" });
    await expect(service.containUserAuthorityLoss(seeded.userId)).resolves.toEqual({
      principalIds: [created.resourceId],
    });
    await expect(service.listPrincipals(siteId)).resolves.toMatchObject([
      {
        id: created.resourceId,
        status: "revoked",
        authority: { kind: "user", userId: null },
        rowVersion: 8,
        tokenVersion: 4,
      },
    ]);

    const invocations = await db
      .select()
      .from(npAgentInvocations)
      .where(and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.actorKind, "staff")));
    const audits = await db.select().from(npAuditEvents).where(eq(npAuditEvents.siteId, siteId));
    expect(invocations).toHaveLength(8);
    expect(audits).toHaveLength(9);
    const evidence = JSON.stringify({ invocations, audits });
    expect(evidence).not.toContain(token.oneTimeValue);
    expect(evidence).not.toContain(rotated.oneTimeValue);
    expect(evidence).not.toContain(replacement.oneTimeValue);
  });
});
