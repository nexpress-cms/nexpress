export const npStorageKeyLength = 2_048;
export const npStorageKeyPattern =
  "^(?!\\.{1,2}(?:/|$))(?!.*(?:/\\.{1,2})(?:/|$))(?!.*//)(?!.*\\/$)[A-Za-z0-9._-][A-Za-z0-9._/-]{0,2047}$";

const storageKeyPattern = new RegExp(npStorageKeyPattern, "u");

/** Shared safe relative object-key predicate used by storage and media rows. */
export function npIsStorageKey(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npStorageKeyLength ||
    value !== value.trim() ||
    !storageKeyPattern.test(value)
  ) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
