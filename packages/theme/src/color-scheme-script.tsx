/**
 * Phase 11.5 — early-init script that applies the right
 * color scheme to `<html>` BEFORE first paint.
 *
 * Order of resolution:
 *   1. The `np-color-scheme` cookie if set ("dark" | "light")
 *   2. The `np-color-scheme` localStorage key (in case cookie
 *      was cleared but the user already chose)
 *   3. `prefers-color-scheme: dark` system preference
 *   4. Else: leave the attribute unset (light defaults)
 *
 * Server-rendered as a synchronous inline script so the
 * attribute is on `<html>` before the body renders. No FOUC
 * for visitors with a saved choice; new visitors with a
 * dark-mode system preference get a single-frame correction.
 *
 * Pure server component — no `"use client"`. Just emits a
 * `<script>` tag with a self-contained snippet.
 */

import { COLOR_SCHEME_COOKIE, COLOR_SCHEME_STORAGE_KEY } from "./color-scheme-keys.js";

const SNIPPET = `
(function () {
  try {
    var d = document.documentElement;
    var get = function (name) {
      var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    };
    var fromCookie = get(${JSON.stringify(COLOR_SCHEME_COOKIE)});
    var fromStorage = null;
    try { fromStorage = window.localStorage.getItem(${JSON.stringify(COLOR_SCHEME_STORAGE_KEY)}); } catch (_) {}
    var pick = fromCookie || fromStorage;
    if (pick === 'dark' || pick === 'light') {
      d.dataset.theme = pick;
      return;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      d.dataset.theme = 'dark';
    }
  } catch (_) {
    /* no-op — color scheme is non-essential */
  }
})();
`.trim();

export function NpColorSchemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SNIPPET }} />;
}
