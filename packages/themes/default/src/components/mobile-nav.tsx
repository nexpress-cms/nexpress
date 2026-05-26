"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { NpNavItem } from "@nexpress/core";

/**
 * Mobile-first nav drawer. The desktop header keeps its inline
 * link list visible above 900px (CSS handles the hide/show);
 * below that breakpoint the inline nav is hidden by CSS and the
 * hamburger button + slide-in drawer take over.
 *
 * Why a client component: the drawer needs `useState` for
 * open/closed, focus-trap on Escape, and scroll-lock on the
 * body. The link list itself is passed in from the server-
 * rendered header so the markup stays SEO-visible even when
 * the drawer is closed.
 */
export interface MobileNavProps {
  items: NpNavItem[];
  /** Optional brand label for the drawer header. Defaults to "Menu". */
  label?: string;
}

const DESKTOP_NAV_QUERY = "(min-width: 901px)";

export function MobileNav({ items, label = "Menu" }: MobileNavProps) {
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

  // Close on Escape and lock body scroll while open. Both effects
  // run only when the drawer is actually open so no listeners
  // hang around in the closed state.
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

  return (
    <>
      <button
        type="button"
        className="np-mobile-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="np-mobile-nav-drawer"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>
      {open ? (
        <div
          className="np-mobile-nav-overlay"
          role="presentation"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id="np-mobile-nav-drawer"
        className="np-mobile-nav-drawer"
        data-open={open ? "true" : "false"}
        aria-hidden={open ? "false" : "true"}
      >
        <header className="np-mobile-nav-drawer-header">
          <span className="np-mobile-nav-drawer-label">{label}</span>
          <button
            type="button"
            className="np-mobile-nav-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </header>
        <ul className="np-mobile-nav-list">
          {items.map((item, index) => (
            <li key={`mobile-nav-${index.toString()}`}>
              {item.url ? (
                <Link href={item.url} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              ) : (
                <span>{item.label}</span>
              )}
              {item.children && item.children.length > 0 ? (
                <ul className="np-mobile-subnav">
                  {item.children.map((child, childIndex) => (
                    <li key={`mobile-nav-${index.toString()}-${childIndex.toString()}`}>
                      {child.url ? (
                        <Link href={child.url} onClick={() => setOpen(false)}>
                          {child.label}
                        </Link>
                      ) : (
                        <span>{child.label}</span>
                      )}
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

function MenuIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}
