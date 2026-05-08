import { getNavigation } from "@nexpress/core";
import type { NpNavItem } from "@nexpress/core";
import * as React from "react";

/**
 * Phase F.6 — `<NavMenu location="primary" />`.
 *
 * Server component for theme shells / slot components. Reads
 * the navigation row at `(siteId, location)` and renders the
 * items as a plain `<ul>` of links. Themes that need richer
 * markup (mega-menus, mobile drawer, etc.) call `getNavigation`
 * themselves and own the rendering — this component is the
 * sensible default for the common case.
 *
 * `location` matches one of the theme's declared `navLocations`
 * keys (or any of the framework defaults: `header` / `footer`
 * / `main`). Empty navigation rows render `null` so themes can
 * safely place this in a slot without leaving an empty `<ul>`
 * behind on first-install.
 */

export interface NpNavMenuProps {
  location: string;
  /** Optional className for the rendered `<ul>`. Defaults to
   *  `np-nav-{location}` so theme CSS can target it. */
  className?: string;
  /** Render an item override. Themes that want custom item
   *  rendering pass a function; the default emits a plain
   *  `<li><a>` pair. */
  renderItem?: (item: NpNavItem, index: number) => React.ReactNode;
}

function defaultRenderItem(item: NpNavItem, index: number): React.ReactNode {
  return (
    <li key={`${item.url}:${index}`}>
      <a href={item.url}>{item.label}</a>
    </li>
  );
}

export async function NavMenu({
  location,
  className,
  renderItem = defaultRenderItem,
}: NpNavMenuProps): Promise<React.ReactElement | null> {
  const items = await getNavigation(location);
  if (items.length === 0) return null;
  return (
    <ul className={className ?? `np-nav-${location}`}>
      {items.map((item, idx) => renderItem(item, idx))}
    </ul>
  );
}
