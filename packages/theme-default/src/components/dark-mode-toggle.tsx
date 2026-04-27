"use client";

import {
  COLOR_SCHEME_COOKIE,
  COLOR_SCHEME_STORAGE_KEY,
  isColorScheme,
  type NxColorScheme,
} from "@nexpress/theme";
import { useEffect, useState } from "react";

/**
 * Phase 11.5 — user-facing dark/light toggle.
 *
 * The early-init `<NxColorSchemeScript />` already set the
 * right attribute on `<html>` before this component mounted,
 * so we just read the current value and let the user flip it.
 * State persists in:
 *   - the `nx-color-scheme` cookie (so the server can render
 *     the right initial attribute on the next request)
 *   - localStorage (covers cookie loss in private mode etc.)
 *
 * Renders nothing until mounted to avoid a hydration mismatch
 * — the server doesn't know what the early-init script chose
 * for first-time visitors.
 */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function readCurrent(): NxColorScheme | null {
  if (typeof document === "undefined") return null;
  const attr = document.documentElement.dataset.theme;
  return isColorScheme(attr) ? attr : null;
}

function writeChoice(choice: NxColorScheme): void {
  document.documentElement.dataset.theme = choice;
  document.cookie = `${COLOR_SCHEME_COOKIE}=${choice}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  try {
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, choice);
  } catch {
    // ignore — storage may be disabled
  }
}

export function DarkModeToggle() {
  const [mounted, setMounted] = useState(false);
  const [scheme, setScheme] = useState<NxColorScheme | null>(null);

  useEffect(() => {
    setMounted(true);
    setScheme(readCurrent());
  }, []);

  if (!mounted) {
    // SSR + first paint: render a fixed-size placeholder so
    // the header layout doesn't reflow when the real button
    // mounts. `aria-hidden` because it's a visual stub.
    return (
      <span
        className="nx-color-scheme-toggle nx-color-scheme-toggle-placeholder"
        aria-hidden="true"
      />
    );
  }

  const next: NxColorScheme = scheme === "dark" ? "light" : "dark";
  const label =
    scheme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      className="nx-color-scheme-toggle"
      onClick={() => {
        writeChoice(next);
        setScheme(next);
      }}
      aria-label={label}
      title={label}
    >
      {scheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
