---
"@nexpress/admin": patch
"@nexpress/blocks": patch
---

Page-builder selected-block preview (#467 #1): focusing a row in the editor now highlights the matching block in the live preview iframe and scrolls it into view. `renderBlocks` gains an opt-in `previewMarkers` flag that wraps each block with a layout-neutral `<div data-np-block-id="…" style="display: contents">`; production renders never enable it. The admin's preview API route flips it on, and `PreviewPanel` reaches into the iframe (which is already `allow-same-origin`) to apply an outline + `scrollIntoView`.
