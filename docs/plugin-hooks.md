# Plugin lifecycle hooks

`definePlugin({ hooks })` gives every canonical hook an exact `data` type.
Handlers receive one shape:

```ts
({ hook, data, ctx }) => void | Promise<void>
```

- `hook` is the literal hook name.
- `data` is the hook-specific payload documented below.
- `ctx` is the plugin runtime context and carries typed config plus the
  capability-gated service namespaces.

Lifecycle hooks are fire-and-forget extension points. They return `void`; a
non-`undefined` runtime return is logged and reported as an invalid plugin
result. Render output is the one exception and uses the separate typed
[`render:beforePage`](plugin-render.md) contribution contract.

## Content hooks

Every content hook uses the same field vocabulary:

| Field              | Meaning                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `collection`       | Registered collection slug.                                                             |
| `documentId`       | Persisted id, or `null` during `content:beforeCreate`.                                  |
| `document`         | Writable draft for `beforeCreate`/`beforeUpdate`; a readonly phase snapshot otherwise.  |
| `originalDocument` | Pre-write row for update/publish transitions; `null` for create, delete, and scheduler. |
| `operation`        | Literal `create`, `update`, or `delete`.                                                |
| `source`           | `request` or `scheduler`.                                                               |
| `principal`        | Staff/member actor, or `null` for scheduler-originated publish events.                  |

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "content-observer",
    version: "0.1.0",
    name: "Content observer",
    description: "Logs persisted content events.",
    author: { name: "Example author" },
    license: "MIT",
    nexpress: { minVersion: "0.3.0" },
  },
  hooks: {
    "content:afterCreate": ({ data, ctx }) => {
      ctx.log.info("Document created", {
        collection: data.collection,
        documentId: data.documentId,
        source: data.source,
      });
    },
  },
});
```

The phase contract is:

| Hook                      | `operation`       | `documentId`  | `originalDocument` | Source               |
| ------------------------- | ----------------- | ------------- | ------------------ | -------------------- |
| `content:beforeCreate`    | `create`          | `null`        | `null`             | request              |
| `content:afterCreate`     | `create`          | string        | `null`             | request              |
| `content:beforeUpdate`    | `update`          | string        | document           | request              |
| `content:afterUpdate`     | `update`          | string        | document or `null` | request or scheduler |
| `content:beforeDelete`    | `delete`          | string        | `null`             | request              |
| `content:afterDelete`     | `delete`          | string        | `null`             | request              |
| `content:beforePublish`   | `create`/`update` | `null`/string | `null`/document    | request              |
| `content:afterPublish`    | `create`/`update` | string        | document or `null` | request or scheduler |
| `content:beforeUnpublish` | `update`          | string        | document           | request              |

`content:beforeCreate` and `content:beforeUpdate` may mutate
`data.document` in place; those mutations run before slug, i18n, field, and
search preparation and therefore reach the persisted row. Do not return a
replacement object. Transition/delete hooks observe their phase without
rewriting the operation. Other top-level payload fields are readonly and the
host shallow-freezes the payload before dispatch. `after*` handlers observe
committed state; errors are isolated and reported without rolling back the
completed write.

Scheduled publish emits `content:afterUpdate` and
`content:afterPublish` with `source: "scheduler"`, `principal: null`, and
`originalDocument: null`.

### Principal narrowing

```ts
"content:afterUpdate": ({ data }) => {
  if (data.principal?.kind === "staff") {
    console.log(data.principal.user.email);
  } else if (data.principal?.kind === "member") {
    console.log(data.principal.memberId);
  } else {
    console.log("scheduled update");
  }
},
```

## Auth hooks

| Hook                 | Data                                                         |
| -------------------- | ------------------------------------------------------------ |
| `auth:afterLogin`    | `{ user: { id, email, role } }`                              |
| `auth:beforeLogout`  | `{ user: { id, email, role } }`                              |
| `auth:afterRegister` | `{ user: { id, email, role }, origin: "admin" \| "invite" }` |

These are staff-auth hooks. Member login/logout uses the member auth surface
and does not emit the staff hook names.

## Media hooks

`media:beforeUpload` receives:

```ts
{
  file: { filename, mimeType, size },
  folderId: string | null,
  principal,
  member,
}
```

`media:afterUpload` replaces `file`/`folderId` with one normalized result:

```ts
{
  media: { id, status, filename, mimeType, size, folderId },
  principal,
  member,
}
```

For staff uploads, `principal.kind === "staff"` and `member === null`. For
member uploads, `principal.kind === "member"` and `member` is the matching
`{ id, email, handle, displayName }` summary.

## Validation boundary

`definePlugin()` rejects unsupported hook names and malformed registration
descriptors during module evaluation. The core dispatcher also validates each
framework-emitted payload before invoking plugins, so JavaScript callers and
incorrect framework integrations fail at the dispatch boundary rather than
delivering a partial shape. A resolved plugin that bypasses `definePlugin()`
still cannot register an unknown hook name.
