export interface NpMobileNavDialogOptions {
  desktopQuery: string;
  onClose: () => void;
}

/**
 * Open a bundled theme's mobile navigation as a native modal. Call from the
 * open state's effect and return this cleanup. The browser owns focus
 * containment and background inertness; React continues to own open state.
 */
export function npOpenMobileNavDialog(
  dialog: HTMLDialogElement,
  trigger: HTMLButtonElement,
  { desktopQuery, onClose }: NpMobileNavDialogOptions,
): () => void {
  const media = window.matchMedia(desktopQuery);
  if (media.matches) {
    onClose();
    return () => {};
  }

  const body = dialog.ownerDocument.body;
  const previousOverflow = body.style.overflow;
  const cancel = (event: Event) => {
    event.preventDefault();
    onClose();
  };
  const resize = () => {
    if (media.matches) onClose();
  };
  const closed = () => {
    // A close event queued by effect cleanup can arrive after a fresh open.
    if (!dialog.open) onClose();
  };
  const wrapFocus = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const stops = Array.from(
      dialog.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]"),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility === "visible",
    );
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) return;
    const active = dialog.ownerDocument.activeElement;
    if (active === dialog || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  };
  const isOutside = (event: MouseEvent) => {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  let startedOutside = false;
  const pointerDown = (event: PointerEvent) => {
    startedOutside = isOutside(event);
  };
  const outsideClick = (event: MouseEvent) => {
    if (startedOutside && isOutside(event)) onClose();
  };

  dialog.showModal();
  body.style.overflow = "hidden";
  dialog.addEventListener("cancel", cancel);
  dialog.addEventListener("close", closed);
  dialog.addEventListener("keydown", wrapFocus);
  dialog.addEventListener("pointerdown", pointerDown);
  dialog.addEventListener("click", outsideClick);
  media.addEventListener("change", resize);

  return () => {
    dialog.removeEventListener("cancel", cancel);
    dialog.removeEventListener("close", closed);
    dialog.removeEventListener("keydown", wrapFocus);
    dialog.removeEventListener("pointerdown", pointerDown);
    dialog.removeEventListener("click", outsideClick);
    media.removeEventListener("change", resize);
    if (dialog.open) dialog.close();
    body.style.overflow = previousOverflow;
    if (trigger.isConnected && trigger.getClientRects().length > 0) {
      trigger.focus({ preventScroll: true });
    }
  };
}
