"use client";

import { useEffect, useState } from "react";

/**
 * Live-ticking local-time pill for the portfolio masthead.
 *
 * The server already SSRs the initial label so a fresh page
 * load doesn't flash a placeholder. After hydration we re-
 * compute the same `"City · HH:MM"` shape once a minute, aligned
 * to the next minute boundary so all visitors see the rollover
 * at the same wall-clock second.
 *
 * Reuses the SSR-emitted initial string as the first state, so
 * if hydration runs and the next render aligns to the boundary,
 * the DOM doesn't flicker.
 */
export function LocalTimeTicker({
  zone,
  initial,
}: {
  zone: string;
  initial: string;
}) {
  const [label, setLabel] = useState(initial);

  useEffect(() => {
    const formatter = safeFormatter(zone);
    if (!formatter) return;
    const city = (zone.split("/").pop() ?? zone).replace(/_/g, " ");

    function tick() {
      const time = formatter!.format(new Date());
      setLabel(`${city} · ${time}`);
    }

    // Schedule the first update at the next minute boundary so
    // every visitor sees ":00" rollovers at the same instant —
    // then settle into a steady 60s tick.
    const now = new Date();
    const msUntilNextMinute =
      1000 * 60 - (now.getSeconds() * 1000 + now.getMilliseconds());
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, 60_000);
    }, msUntilNextMinute);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [zone]);

  return <>{label}</>;
}

/**
 * `Intl.DateTimeFormat` throws on an invalid IANA zone; the
 * SSR path already handles that by falling back to the zone
 * string itself. The client just bails so the SSR label stays
 * stable.
 */
function safeFormatter(zone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
}
