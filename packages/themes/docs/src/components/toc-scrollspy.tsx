"use client";

import { useEffect } from "react";

/**
 * TOC scrollspy.
 *
 * Watches every h2/h3 inside the doc body and stamps the
 * `aria-current` attribute on the matching TOC anchor as the
 * user scrolls. Theme CSS targets `.np-docs-toc li > a[aria-current="true"]`
 * to render the active marker.
 *
 *   - Uses `IntersectionObserver` with a top-biased root margin
 *     so headings activate when they reach the top third of the
 *     viewport (not at center, which would feel laggy on long
 *     sections).
 *   - When multiple sections are visible, the one nearest the
 *     top of the viewport wins.
 *   - Mounted invisibly. The TOC HTML is server-rendered; this
 *     component only adjusts attributes on it post-mount.
 */
export function TocScrollspy({ ids }: { ids: ReadonlyArray<string> }) {
  useEffect(() => {
    if (ids.length === 0) return;
    const headings = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const anchorsById = new Map<string, HTMLAnchorElement>();
    for (const id of ids) {
      const a = document.querySelector<HTMLAnchorElement>(
        `.np-docs-toc a[href="#${cssEscape(id)}"]`,
      );
      if (a) anchorsById.set(id, a);
    }
    if (anchorsById.size === 0) return;

    // Track which heading is "active" by keeping the visible-most
    // entry's id around between observer ticks. Setting `current`
    // is idempotent — only re-stamping changed attrs avoids
    // re-triggering CSS transitions on every scroll frame.
    let current: string | null = null;
    function setCurrent(id: string | null) {
      if (id === current) return;
      if (current !== null) {
        const prev = anchorsById.get(current);
        prev?.removeAttribute("aria-current");
      }
      if (id !== null) {
        const next = anchorsById.get(id);
        next?.setAttribute("aria-current", "true");
      }
      current = id;
    }

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) {
            visible.set(id, entry.boundingClientRect.top);
          } else {
            visible.delete(id);
          }
        }
        if (visible.size === 0) return;
        // Pick the id with the smallest top — that's the heading
        // furthest into the viewport from above.
        let best: { id: string; top: number } | null = null;
        for (const [id, top] of visible) {
          if (best === null || top < best.top) best = { id, top };
        }
        if (best) setCurrent(best.id);
      },
      {
        // Activate when the heading enters the top third of the
        // viewport, deactivate when it leaves the top.
        rootMargin: "0px 0px -66% 0px",
        threshold: [0, 1],
      },
    );

    for (const heading of headings) observer.observe(heading);
    return () => {
      observer.disconnect();
      if (current !== null) {
        const prev = anchorsById.get(current);
        prev?.removeAttribute("aria-current");
      }
    };
  }, [ids]);
  return null;
}

/**
 * Minimal CSS.escape fallback — the heading slugify already
 * produces URL-safe ids (letters/digits/hyphen) so the only
 * thing we need to guard against is the rare hyphen-leading
 * id, which CSS attribute selectors handle natively. Just
 * passing the raw value works for all slugs the editor's
 * `slugifyHeading` emits. Kept as a named helper so a future
 * scope change (e.g. accepting operator-authored ids) only
 * has to upgrade this one spot.
 */
function cssEscape(value: string): string {
  if (typeof window !== "undefined" && typeof window.CSS?.escape === "function") {
    return window.CSS.escape(value);
  }
  return value;
}
