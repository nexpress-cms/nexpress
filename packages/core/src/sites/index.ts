/** `@nexpress/core/sites` — server-side site registry and authorization. */

export { NP_DEFAULT_SITE_ID, npIsCanonicalSiteId, npSiteIdPattern } from "./id-contract.js";
export {
  getCurrentSiteId,
  requireSiteId,
  resetCurrentSiteResolver,
  setCurrentSiteResolver,
  withCurrentSite,
} from "./context.js";
export {
  createSite,
  deleteSite,
  ensureDefaultSite,
  getDefaultSite,
  getSiteByHostname,
  getSiteById,
  getSiteUsageSummary,
  listSites,
  resolveSiteForHostname,
  updateSite,
} from "./registry.js";
export type { NpDeleteSiteOptions, NpSite } from "./registry.js";
export {
  canOnSite,
  getMembership,
  grantSiteMembership,
  isSuperAdmin,
  listMembershipsForUser,
  listSiteMemberships,
  resolveSiteAuthUser,
  revokeSiteMembership,
  setSuperAdmin,
} from "./memberships.js";
export {
  NP_SITE_JOB_QUOTA_WINDOW_MS,
  NP_SITE_QUOTA_SETTING_KEY,
  getSiteQuotaSnapshot,
  getSiteQuotaUsage,
  getSiteQuotas,
  setSiteQuotas,
} from "./quotas.js";
export type { NpSiteJobUsageReader } from "./quotas.js";
export type {
  NpCreateSiteInput,
  NpSiteMembershipGrantInput,
  NpSiteMembershipRecord,
  NpSiteMembershipWireRecord,
  NpSiteQuotaMetric,
  NpSiteQuotaSnapshot,
  NpSiteQuotaUsage,
  NpSiteQuotas,
  NpSiteSummaryWireRecord,
  NpSiteUsage,
  NpSiteWireRecord,
  NpUpdateSiteInput,
} from "../settings/types.js";
