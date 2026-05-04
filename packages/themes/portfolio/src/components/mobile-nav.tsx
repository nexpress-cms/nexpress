"use client";

import { useEffect, useState } from "react";
import type { NxNavItem } from "@nexpress/core";

/**
 * Portfolio theme mobile drawer. Inherits the dark surface; the
 * inline nav hides at <720px (CSS) and a "Menu" button opens
 * a full-screen panel with large links centered.
 */
export interface PortfolioMobileNavProps {
  items: NxNavItem[];
}

export function PortfolioMobileNav({ items }: PortfolioMobileNavProps) {
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
        className="nx-portfolio-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="nx-portfolio-nav-drawer"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "Close" : "Menu"}</span>
      </button>
      <aside
        id="nx-portfolio-nav-drawer"
        className="nx-portfolio-nav-drawer"
        data-open={open ? "true" : "false"}
        aria-hidden={open ? "false" : "true"}
        onClick={(e) => {
          // Click on the backdrop closes; clicks on inner content stop here.
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <ul className="nx-portfolio-nav-drawer-list">
          {items.map((item, index) => (
            <li key={`portfolio-mobile-${index.toString()}`}>
              <a href={item.url} onClick={() => setOpen(false)}>
                {item.label}
              </a>
              {item.children && item.children.length > 0 ? (
                <ul className="nx-portfolio-mobile-subnav">
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
      </aside>
    </>
  );
}
