import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import {
  npAgentActions,
  npAgents,
  npAgentChangesets,
  npAgentPrincipals,
} from "../../../packages/core/src/db/schema/agent.js";
import { publisherRuntimeFixture } from "./agent-publisher-recipe-runtime-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof publisherRuntimeFixture>>;
const active: Fixture[] = [];
async function fixture() {
  const f = await publisherRuntimeFixture();
  active.push(f);
  return f;
}
const run = (f: Fixture) => f.executor.process({ siteId, runId: f.runId });

describe.skipIf(skipIfNoTestDb())("Publisher recipe through actual Runtime owners", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const f of active.splice(0)) await f.dispose();
  });
  afterAll(closeTestDb);

  // Five persisted provider turns and real preview checks form one end-to-end story.
  // Its bounded CI budget is separate from the 30s default for shorter operations.
  it("creates, validates and renders a bounded review proposal without changing public content; replay preserves its actions", async () => {
    const f = await fixture();
    const id = await f.document();
    const before = await f.db.select().from(postsTable).where(eq(postsTable.id, id));
    expect(await run(f)).toEqual({ state: "succeeded" });
    expect(f.invoke).toHaveBeenCalledTimes(5);
    expect(f.render).toHaveBeenCalled();
    expect(await f.db.select().from(postsTable).where(eq(postsTable.id, id))).toEqual(before);
    expect(await f.previews()).toEqual([expect.objectContaining({ state: "ready" })]);
    const changes = await f.db.select().from(npAgentChangesets);
    expect(changes).toHaveLength(1);
    const actions = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.runId, f.runId));
    expect(actions.map((action) => action.capabilityId).sort()).toEqual([
      "changeset.create",
      "changeset.get",
      "changeset.preview",
      "changeset.validate",
    ]);
    expect(await run(f)).toEqual({ state: "succeeded" });
    expect(f.invoke).toHaveBeenCalledTimes(5);
  }, 60_000);

  // Four persisted Runtime runs share the original and independently revised document base.
  // Creation already stops after two provider turns; keep the full isolation story within 60s.
  it("blocks duplicate-base and cross-run draft access while allowing an independently revised base", async () => {
    const f = await fixture();
    const id = await f.document();
    f.finishAfterCreate();
    expect(await run(f)).toEqual({ state: "succeeded" });
    const changes = await f.db.select().from(npAgentChangesets);
    expect(changes).toHaveLength(1);
    await f.rerun();
    expect(await f.db.select().from(npAgentChangesets)).toHaveLength(1);

    f.setGetTarget(changes[0].id);
    expect((await f.rerun()).result.state).not.toBe("succeeded");
    expect(await f.db.select().from(npAgentChangesets)).toHaveLength(1);

    await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        id,
        { title: "Untrusted body marker: independently revised" },
        f.actor.actor.user,
        { status: "published" },
      ),
    );
    await f.db
      .update(postsTable)
      .set({ updatedAt: new Date(f.options.now().getTime() - 90 * 86400000) })
      .where(eq(postsTable.id, id));
    const changed = await f.rerun();
    expect(changed.result).toEqual({ state: "succeeded" });
    expect(await f.db.select().from(npAgentChangesets)).toHaveLength(2);
  }, 60_000);

  it("finishes without a proposal for fresh, unpublished and other-site documents", async () => {
    const f = await fixture();
    await f.document({ old: false });
    await f.document({ status: "draft" });
    await f.document({ siteId: "draft-other" });
    expect(await run(f)).toEqual({ state: "succeeded" });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(await f.db.select().from(npAgentChangesets)).toEqual([]);
    expect(f.render).not.toHaveBeenCalled();
  });

  it("rejects a model-selected document outside the current bounded candidate set", async () => {
    const f = await fixture();
    await f.document();
    const arbitrary = await f.document({ siteId: "draft-other" });
    f.setTarget(arbitrary);
    expect((await run(f)).state).not.toBe("succeeded");
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(await f.db.select().from(npAgentChangesets)).toEqual([]);
  });

  it("rejects a changed document base between provider evidence and proposal admission", async () => {
    const f = await fixture();
    const id = await f.document();
    f.setBeforeProposal(async () => {
      await withCurrentSite(siteId, () =>
        saveDocument("posts", id, { title: "Externally changed" }, f.actor.actor.user, {
          status: "published",
        }),
      );
    });
    expect((await run(f)).state).not.toBe("succeeded");
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(await f.db.select().from(npAgentChangesets)).toEqual([]);
  });

  it("keeps an invalid proposed patch away from public content and preview", async () => {
    const f = await fixture();
    const id = await f.document();
    const before = await f.db.select().from(postsTable).where(eq(postsTable.id, id));
    f.setPatch({ title: 123 });
    expect((await run(f)).state).not.toBe("succeeded");
    expect(f.invoke).toHaveBeenCalled();
    expect(await f.db.select().from(postsTable).where(eq(postsTable.id, id))).toEqual(before);
    expect(await f.previews()).toEqual([]);
    expect(f.render).not.toHaveBeenCalled();
  });

  it("does not reserve a ChangeSet after the delegated principal loses authority", async () => {
    const f = await fixture();
    await f.document();
    const [agent] = await f.db.select().from(npAgents).where(eq(npAgents.id, f.agentId));
    f.setBeforeProposal(async () => {
      await f.db
        .update(npAgentPrincipals)
        .set({ status: "suspended" })
        .where(eq(npAgentPrincipals.id, agent.principalId));
    });
    expect(await run(f)).toEqual({ state: "failed" });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(await f.db.select().from(npAgentChangesets)).toEqual([]);
  });
});
