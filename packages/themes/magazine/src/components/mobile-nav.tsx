"use client";

import { useEffect, useRef, useState } from "react";
import { npOpenMobileNavDialog } from "@nexpress/theme/client";
import type { NpResolvedNavItem } from "@nexpress/core/navigation";

/**
 * Magazine theme mobile drawer. Renders a hamburger that opens
 * a serif-styled slide-down panel from the masthead. Only mounts
 * the drawer when items are present; the inline section nav
 * stays the desktop face.
 */
export interface MagazineMobileNavProps {
  items: NpResolvedNavItem[];
}

const DESKTOP_NAV_QUERY = "(min-width: 761px)";

export function MagazineMobileNav({ items }: MagazineMobileNavProps) {
  const [open, setOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open || !dialogRef.current || !triggerRef.current) return;
    return npOpenMobileNavDialog(dialogRef.current, triggerRef.current, {
      desktopQuery: DESKTOP_NAV_QUERY,
      onClose: () => setOpen(false),
    });
  }, [open]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="np-magazine-mobile-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="np-magazine-mobile-nav-drawer"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "Close" : "Menu"}</span>
      </button>
      <dialog
        ref={dialogRef}
        id="np-magazine-mobile-nav-drawer"
        className="np-magazine-mobile-nav-drawer"
        data-open={open ? "true" : "false"}
        aria-label="Menu"
      >
        <button
          type="button"
          className="np-magazine-mobile-nav-close"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          Close
        </button>
        <ul className="np-magazine-mobile-nav-drawer-list">
          <li>
            <a href="/search" onClick={() => setOpen(false)}>
              Search
            </a>
          </li>
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
      </dialog>
    </>
  );
}
