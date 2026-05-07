/**
 * Pure DOM helpers for the Doc canvas's iframe / parent-doc
 * coordinate dance. Extracted from `doc-canvas.tsx` so the canvas
 * body stays focused on React state + JSX.
 *
 * The Doc canvas renders preview HTML inside a same-origin
 * iframe; hover overlays + drop indicators render in the PARENT
 * document, absolute-positioned over the iframe. Anything
 * touching block geometry has to translate between three
 * coordinate spaces: parent viewport, iframe viewport, and
 * the canvas container's local box.
 */

export interface OverlayPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ResolvedBlockHit {
  id: string;
  /** Visible bounding rect inside the iframe's viewport. */
  rect: DOMRect;
  /** Iframe element's bounding rect in the parent viewport. */
  iframeRect: DOMRect;
}

/**
 * Compute the union bounding rect of an element AND its
 * descendants. The block-marker divs ship `style="display:
 * contents"` so they don't disturb upstream grid / flex layouts —
 * but a `display: contents` element generates no boxes, so its
 * own `getBoundingClientRect()` is `0×0`. Walk down until we hit
 * elements that DO produce boxes, union their rects, and return
 * a real visible bound. Falls back to the original element's
 * rect when nothing visible is found.
 */
export function unionVisibleRect(el: Element): DOMRect {
  const direct = el.getBoundingClientRect();
  if (direct.width > 0 || direct.height > 0) return direct;

  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const visit = (node: Element) => {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      top = Math.min(top, rect.top);
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
      return;
    }
    for (const child of Array.from(node.children)) visit(child);
  };
  for (const child of Array.from(el.children)) visit(child);

  if (top === Infinity) return direct;
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Resolve a parent-doc point (clientX / clientY) back to a block
 * id + visible rect inside the iframe. Returns null when the
 * point is outside the iframe or no `[data-np-block-id]` ancestor
 * sits under the cursor.
 */
export function resolveBlockAt(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
): ResolvedBlockHit | null {
  const doc = iframe.contentDocument;
  if (!doc) return null;
  const iframeRect = iframe.getBoundingClientRect();
  const x = clientX - iframeRect.left;
  const y = clientY - iframeRect.top;
  if (x < 0 || y < 0 || x > iframeRect.width || y > iframeRect.height) {
    return null;
  }
  const el = doc.elementFromPoint(x, y);
  if (!el) return null;
  const blockEl = el.closest<HTMLElement>("[data-np-block-id]");
  if (!blockEl) return null;
  const id = blockEl.dataset.npBlockId;
  if (!id) return null;
  return { id, rect: unionVisibleRect(blockEl), iframeRect };
}

/**
 * Project a block rect (iframe-local viewport coords) into the
 * overlay container's local coordinate space so the rail + drop
 * indicator align flush with the block.
 */
export function projectRect(
  containerRect: DOMRect,
  blockRect: DOMRect,
  iframeRect: DOMRect,
): OverlayPosition {
  return {
    top: iframeRect.top - containerRect.top + blockRect.top,
    left: iframeRect.left - containerRect.left + blockRect.left,
    width: blockRect.width,
    height: blockRect.height,
  };
}
