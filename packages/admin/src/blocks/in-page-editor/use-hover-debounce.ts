import { useCallback, useEffect, useRef } from "react";

const DEFAULT_HIDE_DELAY_MS = 120;

export interface HoverDebounceHandlers {
  /** Cancel any pending hide. Call when hover should persist. */
  cancelHide: () => void;
  /**
   * Arm a delayed hide. No-op when the overlay is currently
   * pinned (cursor sits on the parent-doc rail).
   */
  scheduleHide: () => void;
  /**
   * Pin the overlay. Call from the rail's `onMouseEnter` so any
   * racing `scheduleHide` (from the iframe's `mouseleave` firing
   * after the rail's `mouseenter` on the same handoff frame)
   * short-circuits. Pair with `releaseHover` on the rail's
   * `onMouseLeave`.
   */
  pinHover: () => void;
  /**
   * Release the pin. Pair with `pinHover` on the rail.
   */
  releaseHover: () => void;
}

/**
 * Debounced hover-hide pattern with a pin escape hatch.
 *
 * The Doc canvas's hover affordances live in TWO independent
 * event sources: the iframe's `contentDocument` (where the hover
 * starts) and the parent doc (where the rail with action buttons
 * lives). Cursor handoff between them fires:
 *
 *   1. iframe `mouseleave` → SHOULD hide the overlay
 *   2. rail `mouseenter`   → SHOULD keep the overlay
 *
 * Their order is asymmetric and not guaranteed. A naive
 * cancel/schedule pair lets a stray scheduleHide win the race
 * and tears down the rail mid-click.
 *
 * The pin makes scheduleHide refuse to queue while the cursor is
 * on the rail. `cancelHide` stays for cases where you want to
 * cancel without locking the pin (mousemove inside the iframe,
 * for instance).
 *
 * The hook also clears any pending timer on unmount so React
 * doesn't warn about setState on an unmounted component when the
 * canvas tears down between schedule and fire.
 *
 * @param onHide   Called when the debounce expires (no pin
 *                 active, no cancel in the meantime).
 * @param delayMs  Override the default 120 ms debounce.
 */
export function useHoverDebounce(
  onHide: () => void,
  options: { delayMs?: number } = {},
): HoverDebounceHandlers {
  const delayMs = options.delayMs ?? DEFAULT_HIDE_DELAY_MS;
  const timerRef = useRef<number | null>(null);
  const pinnedRef = useRef(false);
  // Hold `onHide` in a ref so the returned `scheduleHide` is
  // stable across renders even when the caller passes an inline
  // closure. Without this, every parent render would replace
  // scheduleHide and re-fire any effects that depend on it.
  const onHideRef = useRef(onHide);
  useEffect(() => {
    onHideRef.current = onHide;
  }, [onHide]);

  const cancelHide = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    if (pinnedRef.current) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      onHideRef.current();
      timerRef.current = null;
    }, delayMs);
  }, [delayMs]);

  const pinHover = useCallback(() => {
    pinnedRef.current = true;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseHover = useCallback(() => {
    pinnedRef.current = false;
    // Re-arm the hide so the overlay clears once cursor moves on.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      onHideRef.current();
      timerRef.current = null;
    }, delayMs);
  }, [delayMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  return { cancelHide, scheduleHide, pinHover, releaseHover };
}
