import {
  npDigestAgentStudioConnectionDefinitionV1,
  npRequireAgentStudioConnectionDefinitionV1,
  npSerializeAgentStudioConnectionDefinitionV1,
  type NpAgentConnectionAdminOperationIdV1,
  type NpAgentJsonObject,
  type NpAgentStudioConnectionDefinitionV1,
} from "../agent-contract/index.js";

import {
  createAgentAdminAdmissionV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
  type NpAgentAdminExecutionResultV1,
  type NpAgentStaffPrimaryReauthenticationVerifierV1,
} from "./admin-admission.js";
import type { NpAgentConnectionServiceV1 } from "./connection-service.js";

export type NpAgentStudioConnectionAdminOperationIdV1 = Extract<
  NpAgentConnectionAdminOperationIdV1,
  "agents.connections.create" | "agents.connections.revoke"
>;

export interface NpAgentConnectionAdminServiceOptionsV1 {
  connections: NpAgentConnectionServiceV1;
  reauthentication?: NpAgentStaffPrimaryReauthenticationVerifierV1;
  secretRequestDigestKey: { id: string; key: Uint8Array };
  now?: () => Date;
}

function jsonObject<T extends object>(value: T): NpAgentJsonObject {
  return value as unknown as NpAgentJsonObject;
}

function parseDefinitionJson(value: string) {
  let definition: NpAgentStudioConnectionDefinitionV1;
  try {
    definition = npRequireAgentStudioConnectionDefinitionV1(JSON.parse(value) as unknown);
  } catch {
    throw new NpAgentGatewayError(
      "CONNECTION_DEFINITION_INVALID",
      400,
      "The connection definition is invalid.",
    );
  }
  if (npSerializeAgentStudioConnectionDefinitionV1(definition) !== value) {
    throw new NpAgentGatewayError(
      "CONNECTION_DEFINITION_NONCANONICAL",
      400,
      "The connection definition must use canonical JSON.",
    );
  }
  return definition;
}

export function createAgentConnectionAdminServiceV1(
  options: NpAgentConnectionAdminServiceOptionsV1,
) {
  const admit = createAgentAdminAdmissionV1({
    reauthentication: options.reauthentication,
    secretRequestDigestKey: options.secretRequestDigestKey,
    now: options.now,
  });

  async function executeAdmin<I extends NpAgentStudioConnectionAdminOperationIdV1>(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    operationId: I;
    targetId: string | null;
    command: unknown;
  }): Promise<NpAgentAdminExecutionResultV1<NpAgentJsonObject>> {
    if (input.operationId === "agents.connections.create") {
      if (input.targetId !== null) {
        throw new NpAgentGatewayError(
          "INVALID_ADMIN_TARGET",
          400,
          "Connection creation does not accept a target id.",
        );
      }
      return admit({
        ...input,
        operationId: "agents.connections.create",
        mutate: async ({ db, now, invocationId, command }) => {
          const definition = parseDefinitionJson(command.definitionJson);
          if (
            (await npDigestAgentStudioConnectionDefinitionV1(definition)) !== command.definitionHash
          ) {
            throw new NpAgentGatewayError(
              "CONNECTION_DEFINITION_HASH_MISMATCH",
              409,
              "The connection definition hash does not match.",
            );
          }
          if (
            (definition.authKind === "api_key" && command.credential.length === 0) ||
            (definition.authKind === "oauth" && command.credential.length !== 0)
          ) {
            throw new NpAgentGatewayError(
              "CONNECTION_CREDENTIAL_KIND_MISMATCH",
              400,
              "The write-only credential does not match the selected auth kind.",
            );
          }
          const credential =
            definition.authKind === "api_key" ? new TextEncoder().encode(command.credential) : null;
          try {
            const created = await options.connections.admitCreateConnection({
              ...definition,
              siteId: input.siteId,
              createdBy: input.actor.user.id,
              db,
              admittedAt: now,
              invocationId,
              idempotencyKey: command.idempotencyKey,
              vaultOperationId: command.vaultOperationId,
              apiKey: credential,
            });
            return {
              resourceId: created.connection.id,
              output: jsonObject(created.connection),
              ...(created.afterCommit
                ? {
                    afterCommit: async () => {
                      try {
                        await created.afterCommit?.();
                      } finally {
                        credential?.fill(0);
                      }
                    },
                  }
                : {}),
            };
          } catch (error) {
            credential?.fill(0);
            throw error;
          }
        },
      });
    }

    if (input.targetId === null) {
      throw new NpAgentGatewayError(
        "INVALID_ADMIN_TARGET",
        400,
        "Connection revocation requires one target id.",
      );
    }
    return admit({
      ...input,
      operationId: "agents.connections.revoke",
      targetId: input.targetId,
      mutate: async ({ db, now, command }) => {
        const revoked = await options.connections.admitRevokeConnection({
          siteId: input.siteId,
          connectionId: input.targetId!,
          expectedConfigVersion: command.expectedVersion,
          db,
          admittedAt: now,
        });
        return {
          resourceId: revoked.connection.id,
          output: jsonObject(revoked.connection),
          afterCommit: revoked.afterCommit,
        };
      },
    });
  }

  return Object.freeze({ executeAdmin });
}

export type NpAgentConnectionAdminServiceV1 = ReturnType<
  typeof createAgentConnectionAdminServiceV1
>;
