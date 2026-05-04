---
"@nexpress/admin": minor
"@nexpress/web": patch
"create-nexpress": minor
---

Three small nav follow-ups grouped into one cleanup:

- **Lock down `/api/navigation/locations`.** The endpoint now
  requires staff auth + the `admin.manage` capability instead of
  allowing anonymous reads. The data is technically inferable
  from rendered nav menus, but enumerating every custom slot
  via one HTTP call shouldn't be free.
- **CLI page template opts into `navMembership`.** Sites
  scaffolded with `create-nexpress` get the "In navigation"
  side-panel on the page edit view out of the box, matching the
  reference app's behavior. Comment explains the flag for
  operators who add a `landing-pages` or `static-pages`
  collection later.
- **Arrow-key navigation in the page picker.** ArrowDown / ArrowUp
  move the highlighted row; Enter commits. Radix Popover already
  handles Esc → close. The previously-selected page is shown
  with a subtle ring when it isn't the active row, so the
  operator can see both "where I am" and "what I had".
