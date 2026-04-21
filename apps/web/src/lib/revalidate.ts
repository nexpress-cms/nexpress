import { revalidatePath } from "next/cache";

/**
 * Invalidates Next's render cache for routes that depend on a collection
 * document. Called inline after create/update/delete succeeds. This is the
 * MVP-α stand-in for the design's `content:afterPublish` → `revalidateTag`
 * flow — once pg-boss is wired, this logic should move into a job handler.
 */
export function revalidateCollection(
  slug: string,
  doc?: Record<string, unknown> | null,
): void {
  const documentSlug =
    doc && typeof doc.slug === "string" ? doc.slug : undefined;

  switch (slug) {
    case "posts": {
      revalidatePath("/blog");
      if (documentSlug) {
        revalidatePath(`/blog/${documentSlug}`);
      }
      return;
    }
    case "pages": {
      if (!documentSlug || documentSlug === "/" || documentSlug === "home") {
        revalidatePath("/");
        return;
      }
      revalidatePath(`/${documentSlug}`);
      return;
    }
    default: {
      // Unknown collection — no page convention to revalidate. Consumers can
      // extend this when they add site routes for new collections.
    }
  }
}
