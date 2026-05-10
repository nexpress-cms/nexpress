---
"@nexpress/admin": patch
---

**A11y: PagePicker trigger declares `aria-haspopup="listbox"`.**

The navigation editor's PagePicker uses Radix Popover, whose trigger
auto-applies `aria-expanded` but NOT `aria-haspopup`. Without it,
the closed trigger reads as a plain button to screen readers — no
hint that activating it surfaces a list of pages. Declaring
`aria-haspopup="listbox"` matches the WAI-ARIA combobox pattern
already in place inside the popover (`role="listbox"` on the
results, `role="option"` per row).

One-line polish item carried over from the post-#433 nav editor
follow-up backlog.
