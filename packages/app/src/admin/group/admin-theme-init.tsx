"use client";

import { useEffect } from "react";

const STORAGE_KEY = "np-theme";

export function AdminThemeInit() {
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const mode = stored === "light" || stored === "dark" ? stored : "system";
      const dark =
        mode === "dark" ||
        (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      // Ignore storage or media-query failures; the admin shell remains usable.
    }
  }, []);

  return null;
}
