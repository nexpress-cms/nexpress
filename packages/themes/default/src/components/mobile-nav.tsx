"use client";

import { useEffect, useState } from "react";
import type { NxNavItem } from "@nexpress/core";

/**
 * Mobile-first nav drawer. The desktop header keeps its inline
 * link list visible above ~768px (CSS handles the hide/show);
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
  items: NxNavItem[];
  /** Optional brand label for the drawer header. Defaults to "Menu". */
  label?: string;
}

export function MobileNav({ items, label = "Menu" }: MobileNavProps) {
  const [open, setOpen] = useState(false);

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
        className="nx-mobile-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="nx-mobile-nav-drawer"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>
      {open ? (
        <div
          className="nx-mobile-nav-overlay"
          role="presentation"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id="nx-mobile-nav-drawer"
        className="nx-mobile-nav-drawer"
        data-open={open ? "true" : "false"}
        aria-hidden={open ? "false" : "true"}
      >
        <header className="nx-mobile-nav-drawer-header">
          <span className="nx-mobile-nav-drawer-label">{label}</span>
          <button
            type="button"
            className="nx-mobile-nav-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </header>
        <ul className="nx-mobile-nav-list">
          {items.map((item, index) => (
            <li key={`mobile-nav-${index.toString()}`}>
              <a href={item.url} onClick={() => setOpen(false)}>
                {item.label}
              </a>
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
