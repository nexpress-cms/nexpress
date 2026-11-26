// This host-only entry deliberately imports no Forum route, skin, service or
// factory. Its guards share the server entry's private identity registrations.
export { npIsForumBuildRouteOwnerV1, npIsForumBuildPreviewAdapterV1 } from "./build-identity.js";
export type {
  NpForumBuildRouteOwnerV1,
  NpForumBuildPreviewAdapterV1,
} from "./build-contract-types.js";
