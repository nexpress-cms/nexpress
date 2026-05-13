// Stub — see ./init-core.ts.
import type { NpAuthUser } from "@nexpress/core";

export async function canManageSite(_user: NpAuthUser, _siteId: string): Promise<boolean> {
  return false;
}
export async function canModerateSite(_user: NpAuthUser, _siteId: string): Promise<boolean> {
  return false;
}
