import type {
  NpForumBuildPreviewAdapterV1,
  NpForumBuildRouteOwnerV1,
} from "./build-contract-types.js";

// Private to the server bundle's shared identity chunk. Public entries export
// only guards; authored JSON and imported lookalikes cannot register identities.
const owners = new WeakSet<object>();
const previewAdapters = new WeakSet<object>();
const value = (object: object, key: string): unknown => {
  const field = Object.getOwnPropertyDescriptor(object, key);
  return field && "value" in field ? field.value : undefined;
};

export function isForumBuildRouteOwnerUnchanged(owner: NpForumBuildRouteOwnerV1): boolean {
  return (
    value(owner.route, "component") === owner.routeComponent &&
    value(owner.route, "pattern") === owner.routePattern &&
    value(owner.route, "metadata") === owner.routeMetadata &&
    value(owner.template, "component") === owner.templateComponent
  );
}

/** Internal factory registration; never reexported by a package entry. */
export function registerForumBuildRouteOwner(owner: NpForumBuildRouteOwnerV1): void {
  owners.add(owner);
}

/** Internal factory registration; never reexported by a package entry. */
export function registerForumBuildPreviewAdapter(adapter: NpForumBuildPreviewAdapterV1): void {
  previewAdapters.add(adapter);
}

/** Host identity check only. JSON, object copies and another module's descriptors cannot mint it. */
export function npIsForumBuildRouteOwnerV1(value: unknown): value is NpForumBuildRouteOwnerV1 {
  return value !== null && typeof value === "object" && owners.has(value);
}

/** Same-module identity plus fresh source-owner bindings; not render/authorization evidence. */
export function npIsForumBuildPreviewAdapterV1(
  value: unknown,
): value is NpForumBuildPreviewAdapterV1 {
  if (value === null || typeof value !== "object" || !previewAdapters.has(value)) return false;
  const adapter = value as NpForumBuildPreviewAdapterV1;
  return (
    npIsForumBuildRouteOwnerV1(adapter.owner) &&
    isForumBuildRouteOwnerUnchanged(adapter.owner) &&
    adapter.route === adapter.owner.route &&
    adapter.template === adapter.owner.template
  );
}
