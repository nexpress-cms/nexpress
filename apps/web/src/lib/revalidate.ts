import {
  defaultRevalidationRules,
  revalidateCollection as coreRevalidateCollection,
} from "@nexpress/next";

export function revalidateCollection(
  slug: string,
  doc?: Record<string, unknown> | null,
): void {
  coreRevalidateCollection(defaultRevalidationRules, slug, doc);
}
