"use client";

import { useEffect, useRef, useState } from "react";
import { npOpenMobileNavDialog } from "@nexpress/theme/client";
import type { NpResolvedNavItem } from "@nexpress/core/navigation";

/**
 * Portfolio theme mobile drawer. Inherits the dark surface; the
 * inline nav hides at ≤880px (CSS) and a "Menu" button opens
 * a full-screen panel with large links centered.
 */
export interface PortfolioMobileNavProps {
  items: NpResolvedNavItem[];
}

const DESKTOP_NAV_QUERY = "(min-width: 881px)";

export function PortfolioMobileNav({ items }: PortfolioMobileNavProps) {
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
        className="np-portfolio-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="np-portfolio-nav-drawer"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "Close" : "Menu"}</span>
      </button>
      <dialog
        ref={dialogRef}
        id="np-portfolio-nav-drawer"
        className="np-portfolio-nav-drawer"
        data-open={open ? "true" : "false"}
        aria-label="Menu"
        onClick={(e) => {
          // Click on the backdrop closes; clicks on inner content stop here.
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <button
          type="button"
          className="np-portfolio-nav-close"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          Close
        </button>
        <ul className="np-portfolio-nav-drawer-list">
          <li>
            <a href="/search" onClick={() => setOpen(false)}>
              Search
            </a>
          </li>
          {items.map((item, index) => (
            <li key={`portfolio-mobile-${index.toString()}`}>
              <a href={item.url} onClick={() => setOpen(false)}>
                {item.label}
              </a>
              {item.children && item.children.length > 0 ? (
                <ul className="np-portfolio-mobile-subnav">
                  {item.children.map((child, childIndex) => (
                    <li key={`portfolio-mobile-${index.toString()}-${childIndex.toString()}`}>
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
