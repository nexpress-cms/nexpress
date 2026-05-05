---
"@nexpress/blocks": minor
"@nexpress/next": patch
---

Fix `reloadPlugins()` leaving disabled plugins' block definitions in the shared block registry (#477).

`resetPlugins()` clears hooks / routes / actions / scheduled tasks
on reload, but block definitions live in the separate shared block
registry (`@nexpress/blocks`'s `sharedDefinitions` map). After an
operator disabled a block plugin and clicked "Reload all", the
disabled plugin's blocks would still:

- Surface in the admin's Add-block popover.
- Resolve during server render so existing pages kept rendering
  the disabled plugin's blocks instead of falling back to the
  unknown-block placeholder.

`@nexpress/blocks` now exports `resetSharedBlockRegistry()`, which
clears the registry and re-seeds the built-ins. The
`@nexpress/next` bootstrap calls it inside `reloadPlugins()` right
after `resetPlugins()` and before re-registering blocks from
currently-enabled plugins. The post-reload registry settles on
`built-ins + currently-enabled plugin contributions`.

Added a regression test in `bootstrap.test.ts` that pins both
`resetPlugins` and `resetSharedBlockRegistry` getting called once
per reload.
