"use client";

import { useEffect, useState } from "react";
import type { NpNavItem } from "@nexpress/core";

/**
 * Portfolio theme mobile drawer. Inherits the dark surface; the
 * inline nav hides at <720px (CSS) and a "Menu" button opens
 * a full-screen panel with large links centered.
 */
export interface PortfolioMobileNavProps {
  items: NpNavItem[];
}

const DESKTOP_NAV_QUERY = "(min-width: 881px)";

export function PortfolioMobileNav({ items }: PortfolioMobileNavProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_NAV_QUERY);
    const closeForDesktop = () => {
      if (media.matches) setOpen(false);
    };

    closeForDesktop();
    media.addEventListener("change", closeForDesktop);
    return () => {
      media.removeEventListener("change", closeForDesktop);
    };
  }, []);

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
        className="np-portfolio-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="np-portfolio-nav-drawer"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "Close" : "Menu"}</span>
      </button>
      <aside
        id="np-portfolio-nav-drawer"
        className="np-portfolio-nav-drawer"
        data-open={open ? "true" : "false"}
        aria-hidden={open ? "false" : "true"}
        onClick={(e) => {
          // Click on the backdrop closes; clicks on inner content stop here.
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <ul className="np-portfolio-nav-drawer-list">
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
      </aside>
    </>
  );
}
