import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import {
  npAgentPublisherRecipeSetupV1,
  npCreateAgentPublisherRecipeDefinitionV1,
} from "./publisher-recipe-contract.js";
import { npRequireAgentConfigurationDefinitionV1 } from "./runtime-contract.js";

const id = "11111111-1111-4111-8111-111111111111";
const digest = `cj1:sha256:${"A".repeat(43)}`;
describe("shipped Publisher review recipe", () => {
  it("embeds real capability schemas including their references and excludes execution", async () => {
    const recipe = await npCreateAgentPublisherRecipeDefinitionV1();
    expect(recipe.triggerKinds).toEqual(["manual"]);
    expect(recipe.manualInputSchema).toBeNull();
    expect(recipe.instruction!.digest).toBe(
      `cj1:sha256:${createHash("sha256").update(recipe.instruction!.text).digest("base64url")}`,
    );
    const decisions = [
      { kind: "complete", summary: "No justified improvement." },
      {
        kind: "propose-capability",
        capabilityId: "changeset.create",
        rationale: "Improve a stale description.",
        arguments: {
          title: "Review metadata",
          summary: null,
          operations: [
            {
              clientOperationId: "description",
              reason: "Missing description",
              kind: "document",
              operation: "update",
              resource: { collection: "posts", documentId: id },
              base: { version: "updated:2026-01-01T00:00:00.000Z", digest },
              input: { patch: { title: "Clear title" }, targetStatus: "published" },
            },
          ],
        },
      },
      {
        kind: "propose-capability",
        capabilityId: "changeset.validate",
        rationale: "Validate",
        arguments: { changeSetId: id, draftVersion: 1, draftHash: digest },
      },
      {
        kind: "propose-capability",
        capabilityId: "changeset.preview",
        rationale: "Preview",
        arguments: { changeSetId: id, planHash: digest },
      },
      {
        kind: "propose-capability",
        capabilityId: "content.query",
        rationale: "Read",
        arguments: {
          collection: "posts",
          filter: { op: "eq", field: "status", value: "published" },
          fields: ["title"],
          audience: "public",
          status: "published",
          sort: [],
          limit: 1,
          cursor: null,
        },
      },
    ];
    for (const decision of decisions)
      npRequireAgentProviderSchemaValueV1(
        recipe.responseSchema,
        JSON.parse(JSON.stringify({ task: "interactive-capability", decision })),
      );
    for (const capabilityId of [
      "changeset.apply",
      "changeset.schedule",
      "changeset.rollback",
      "ops.execute",
    ]) {
      expect(recipe.capabilityIds).not.toContain(capabilityId);
      expect(() =>
        npRequireAgentProviderSchemaValueV1(recipe.responseSchema, {
          task: "interactive-capability",
          decision: {
            kind: "propose-capability",
            capabilityId,
            rationale: "Execute",
            arguments: {},
          },
        }),
      ).toThrow();
    }
    expect(() =>
      npRequireAgentProviderSchemaValueV1(recipe.responseSchema, {
        task: "interactive-capability",
        decision: {
          kind: "propose-capability",
          capabilityId: "changeset.create",
          rationale: "Invalid",
          arguments: { title: "Review", summary: null, operations: [{ arbitrary: true }] },
        },
      }),
    ).toThrow();
  });
  it("requires explicit collection selection and keeps activation/provider authority separate", async () => {
    const setup = npAgentPublisherRecipeSetupV1;
    const definition = {
      schemaVersion: "np.agent-configuration-definition.v1",
      name: "Publisher",
      template: "publisher",
      modelConnectionId: null,
      model: null,
      scopes: setup.scopes,
      autonomy: setup.autonomy,
      capabilityModes: setup.capabilityModes,
      policyMode: "site",
      budget: setup.budget,
      settings: [setup.settings],
    };
    expect(() => npRequireAgentConfigurationDefinitionV1(definition)).toThrow();
    const selected = npRequireAgentConfigurationDefinitionV1({
      ...definition,
      settings: [{ ...setup.settings, collectionSlugs: ["posts"] }],
    });
    const recipe = await npCreateAgentPublisherRecipeDefinitionV1();
    npRequireAgentProviderSchemaValueV1(
      recipe.settingsSchema,
      JSON.parse(JSON.stringify(selected.settings[0])),
    );
    expect(selected.scopes).not.toContain("changeset:apply");
    expect(selected.budget.directActionsPerHour).toBe(0);
    recipe.capabilityIds.push("changeset.apply");
    expect((await npCreateAgentPublisherRecipeDefinitionV1()).capabilityIds).not.toContain(
      "changeset.apply",
    );
  });
});
