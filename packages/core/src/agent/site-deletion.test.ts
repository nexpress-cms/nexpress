import { describe, expect, it } from "vitest";

import {
  NP_AGENT_SITE_DELETION_MARKER_TABLE,
  npAgentSiteDeletionOrderV1,
  npAgentSiteOwnedTableNamesV1,
  npBuildAgentSiteDeletionRowIdentityDigest,
} from "./site-deletion.js";

const expectedTables = [
  "np_agent_connection_auth_requests",
  "np_agent_connection_config_versions",
  "np_agent_connection_operations",
  "np_agent_connection_secret_versions",
  "np_agent_connections",
  "np_agent_invocations",
  "np_agent_oauth_clients",
  "np_agent_oauth_codes",
  "np_agent_oauth_grants",
  "np_agent_oauth_refresh_tokens",
  "np_agent_oauth_requests",
  "np_agent_principals",
  "np_agent_service_tokens",
  "np_agent_vault_entries",
  "np_agent_vault_operations",
] as const;

describe("Agent site deletion foundation", () => {
  it("owns one exact sorted inventory and dependency-complete deletion order", () => {
    expect(npAgentSiteOwnedTableNamesV1).toEqual(expectedTables);
    expect(new Set(npAgentSiteDeletionOrderV1)).toEqual(new Set(expectedTables));
    expect(npAgentSiteDeletionOrderV1).toHaveLength(expectedTables.length);
    expect(npAgentSiteOwnedTableNamesV1).not.toContain(NP_AGENT_SITE_DELETION_MARKER_TABLE);
    expect(NP_AGENT_SITE_DELETION_MARKER_TABLE).toBe("np_agent_site_deletion_sagas");
  });

  it("locks independent empty and populated sdri1 golden vectors", () => {
    expect(npBuildAgentSiteDeletionRowIdentityDigest("np_agent_principals", [])).toBe(
      "sdri1:sha256:Il5FiIdiPymaPsX7UXyRysjglJHk1iWLRrn1YA09z0w",
    );
    expect(
      npBuildAgentSiteDeletionRowIdentityDigest("np_agent_principals", [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ]),
    ).toBe("sdri1:sha256:dAneY5cRgAgcrmssCbi4IvMQyhvydHfgsDQZmXOLtdE");
  });

  it("rejects unknown, unsorted, duplicate, and malformed identities", () => {
    expect(() => npBuildAgentSiteDeletionRowIdentityDigest("np_agent_runs" as never, [])).toThrow(
      "Unknown Agent site-owned table",
    );
    expect(() =>
      npBuildAgentSiteDeletionRowIdentityDigest("np_agent_principals", [
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000001",
      ]),
    ).toThrow("canonical sorted UUIDs");
    expect(() =>
      npBuildAgentSiteDeletionRowIdentityDigest("np_agent_principals", [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000001",
      ]),
    ).toThrow("canonical sorted UUIDs");
    expect(() =>
      npBuildAgentSiteDeletionRowIdentityDigest("np_agent_principals", ["NOT-A-UUID"]),
    ).toThrow("canonical sorted UUIDs");
  });
});
