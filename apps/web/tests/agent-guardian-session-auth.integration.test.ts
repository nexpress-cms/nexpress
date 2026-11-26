import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createStaffSession,
  rotateStaffSession,
  verifyTokenFull,
} from "../../../packages/core/src/auth/session.js";
import {
  createMemberSession,
  getMemberFromTokenPayload,
  rotateMemberSession,
} from "../../../packages/core/src/auth/member-session.js";
import { verifyMemberToken } from "../../../packages/core/src/auth/member-token.js";
import {
  npReadGuardianSessionFamilyV1,
  npRevokeGuardianSessionFamilyV1,
  type NpGuardianSessionFamilyRefV1,
} from "../../../packages/core/src/auth/guardian-session.js";
import { npUsers } from "../../../packages/core/src/db/schema/system.js";
import { npMembers } from "../../../packages/core/src/db/schema/community.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  seedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const secret = process.env.NP_SECRET as string;
const options = { accessExpiration: 7200, refreshExpiration: 604800 };
async function fixture(actorKind: "staff" | "member") {
  const db = await getTestDb();
  if (actorKind === "staff") {
    const seeded = await seedUser({ email: "guardian-family@example.com" });
    const [user] = await db
      .select({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
      })
      .from(npUsers)
      .where(eq(npUsers.id, seeded.userId));
    if (!user) throw new Error("Staff fixture absent");
    const create = () => createStaffSession(user, secret, db, options);
    return {
      db,
      actorKind,
      principalId: user.id,
      create,
      rotate: (refresh: string) => rotateStaffSession(refresh, secret, db, options),
      verifyAccess: (access: string) => verifyTokenFull(access, secret, db),
      readTokenVersion: async () => {
        const [row] = await db
          .select({ tokenVersion: npUsers.tokenVersion })
          .from(npUsers)
          .where(eq(npUsers.id, user.id));
        return row?.tokenVersion;
      },
    };
  }
  const seeded = await seedActiveMember({ email: "guardian-family@example.com" });
  const [member] = await db
    .select({
      id: npMembers.id,
      email: npMembers.email,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
      status: npMembers.status,
      tokenVersion: npMembers.tokenVersion,
    })
    .from(npMembers)
    .where(eq(npMembers.id, seeded.memberId));
  if (!member) throw new Error("Member fixture absent");
  const create = () => createMemberSession(member, secret, db, options);
  return {
    db,
    actorKind,
    principalId: member.id,
    create,
    rotate: (refresh: string) => rotateMemberSession(refresh, secret, db, options),
    verifyAccess: async (access: string) =>
      getMemberFromTokenPayload(db, await verifyMemberToken(access, secret, "access"), access),
    readTokenVersion: async () => {
      const [row] = await db
        .select({ tokenVersion: npMembers.tokenVersion })
        .from(npMembers)
        .where(eq(npMembers.id, member.id));
      return row?.tokenVersion;
    },
  };
}

describe.skipIf(skipIfNoTestDb())("Guardian exact browser family auth effect", () => {
  beforeAll(ensureMigrated);
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  for (const actorKind of ["staff", "member"] as const) {
    it(`${actorKind}: revokes the selected rotated access/refresh family while another family and a new login survive`, async () => {
      const f = await fixture(actorKind);
      const selected = await f.create(),
        sibling = await f.create();
      const ref: NpGuardianSessionFamilyRefV1 = {
        actorKind,
        principalId: f.principalId,
        sessionFamilyId: selected.sessionId,
      };
      const original = await npReadGuardianSessionFamilyV1(f.db, ref);
      if (!original) throw new Error("Family fixture absent");
      expect(Object.keys(original).sort()).toEqual([
        "accessExpiresAt",
        "actorKind",
        "createdAt",
        "principalId",
        "refreshExpiresAt",
        "sessionFamilyId",
      ]);
      const rotated = await f.rotate(selected.refresh);
      if (!rotated) throw new Error("Expected a live refresh pair");
      expect(rotated.sessionId).toBe(selected.sessionId);
      expect(await f.verifyAccess(rotated.access)).toMatchObject({ id: f.principalId });
      expect((await npReadGuardianSessionFamilyV1(f.db, ref))?.createdAt).toBe(original.createdAt);

      await f.db.transaction(async (tx) => {
        expect(await npReadGuardianSessionFamilyV1(tx, ref, { lock: true })).not.toBeNull();
        expect(await npRevokeGuardianSessionFamilyV1(tx, ref, original.createdAt)).toBe(true);
      });
      expect(await npReadGuardianSessionFamilyV1(f.db, ref)).toBeNull();
      expect(await f.verifyAccess(rotated.access)).toBeNull();
      expect(await f.rotate(rotated.refresh)).toBeNull();
      expect(await f.verifyAccess(selected.access)).toBeNull();
      expect(await f.rotate(selected.refresh)).toBeNull();
      expect(await f.verifyAccess(sibling.access)).toMatchObject({ id: f.principalId });
      expect(await f.rotate(sibling.refresh)).not.toBeNull();
      expect(await f.readTokenVersion()).toBe(0);
      expect(await npRevokeGuardianSessionFamilyV1(f.db, ref, original.createdAt)).toBe(false);

      const fresh = await f.create();
      expect(fresh.sessionId).not.toBe(selected.sessionId);
      expect(await f.verifyAccess(fresh.access)).toMatchObject({ id: f.principalId });
      expect(await f.rotate(fresh.refresh)).not.toBeNull();
    });

    it(`${actorKind}: rejects mismatched owner, family, creation and audience without revoking the live pair`, async () => {
      const f = await fixture(actorKind),
        selected = await f.create();
      const ref: NpGuardianSessionFamilyRefV1 = {
        actorKind,
        principalId: f.principalId,
        sessionFamilyId: selected.sessionId,
      };
      const original = await npReadGuardianSessionFamilyV1(f.db, ref);
      if (!original) throw new Error("Family fixture absent");
      for (const other of [
        { ...ref, principalId: randomUUID() },
        { ...ref, sessionFamilyId: randomUUID() },
        { ...ref, actorKind: actorKind === "staff" ? ("member" as const) : ("staff" as const) },
      ]) {
        expect(await npReadGuardianSessionFamilyV1(f.db, other)).toBeNull();
        expect(await npRevokeGuardianSessionFamilyV1(f.db, other, original.createdAt)).toBe(false);
      }
      expect(
        await npRevokeGuardianSessionFamilyV1(
          f.db,
          ref,
          new Date(Date.parse(original.createdAt) + 1).toISOString(),
        ),
      ).toBe(false);
      expect(await f.verifyAccess(selected.access)).toMatchObject({ id: f.principalId });
      expect(await f.rotate(selected.refresh)).not.toBeNull();
      expect(await f.readTokenVersion()).toBe(0);
    });

    it(`${actorKind}: rolls back family revocation with its caller's failed atomic transaction`, async () => {
      const f = await fixture(actorKind),
        selected = await f.create();
      const ref: NpGuardianSessionFamilyRefV1 = {
        actorKind,
        principalId: f.principalId,
        sessionFamilyId: selected.sessionId,
      };
      const original = await npReadGuardianSessionFamilyV1(f.db, ref);
      if (!original) throw new Error("Family fixture absent");
      await expect(
        f.db.transaction(async (tx) => {
          expect(await npRevokeGuardianSessionFamilyV1(tx, ref, original.createdAt)).toBe(true);
          expect(await npReadGuardianSessionFamilyV1(tx, ref)).toBeNull();
          throw new Error("Simulated approval/result persistence failure");
        }),
      ).rejects.toThrow("Simulated approval/result persistence failure");
      expect(await f.verifyAccess(selected.access)).toMatchObject({ id: f.principalId });
      expect(await f.rotate(selected.refresh)).not.toBeNull();
      expect(await f.readTokenVersion()).toBe(0);
    });
  }
});
