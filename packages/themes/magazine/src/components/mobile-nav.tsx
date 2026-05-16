"use client";

import { useEffect, useState } from "react";
import type { NpNavItem } from "@nexpress/core";

/**
 * Magazine theme mobile drawer. Renders a hamburger that opens
 * a serif-styled slide-down panel from the masthead. Only mounts
 * the drawer when items are present; the inline section nav
 * stays the desktop face.
 */
export interface MagazineMobileNavProps {
  items: NpNavItem[];
}

export function MagazineMobileNav({ items }: MagazineMobileNavProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="np-magazine-mobile-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="np-magazine-mobile-nav-drawer"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "Close" : "Menu"}</span>
      </button>
      {open ? (
        <div
          className="np-magazine-mobile-nav-overlay"
          role="presentation"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id="np-magazine-mobile-nav-drawer"
        className="np-magazine-mobile-nav-drawer"
        data-open={open ? "true" : "false"}
        aria-hidden={open ? "false" : "true"}
      >
        <ul className="np-magazine-mobile-nav-drawer-list">
          {items.map((item, index) => (
            <li key={`magazine-mobile-${index.toString()}`}>
              <a href={item.url} onClick={() => setOpen(false)}>
                {item.label}
              </a>
              {item.children && item.children.length > 0 ? (
                <ul className="np-magazine-mobile-subnav">
                  {item.children.map((child, childIndex) => (
                    <li key={`magazine-mobile-${index.toString()}-${childIndex.toString()}`}>
                      <a href={child.url} onClick={() => setOpen(false)}>
                        {child.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
