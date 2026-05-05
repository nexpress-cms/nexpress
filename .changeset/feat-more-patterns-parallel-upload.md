---
"@nexpress/admin": minor
---

Page builder — five new built-in patterns + parallel media uploads (#467 follow-ups).

- **Built-in patterns**: CTA section, Feature grid section, Image
  gallery section, Contact section. Combined with the original
  three (Landing hero, FAQ, Pricing) the operator now has eight
  ready-to-drop section templates covering the common landing-page
  beats.
- **Parallel media uploads**: `BlockImagePicker.handleUploadFiles`
  switches from a sequential `for…of` loop to `Promise.allSettled`.
  A 5-image batch now finishes in ~1× the slowest upload instead
  of the sum. Per-file failures don't block the rest; the URL
  field gets the last successful upload's URL and a banner
  reports `N of M failed` when applicable.

Backward compatible. The pattern list is additive (existing custom
patterns / saved-as-pattern flow unchanged); the upload handler's
external surface (`onChange(url)` + listing refresh) is identical.
