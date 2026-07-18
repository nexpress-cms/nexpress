# @nexpress/plugin-webhook-relay

Reference integration plugin that relays content create, update, and delete
events to an operator-configured HTTP endpoint.

```bash
pnpm exec nexpress plugin add @nexpress/plugin-webhook-relay
```

The generated Admin form configures the endpoint, optional HMAC signing secret,
draft behavior, and timeout. Requests carry JSON with the event, collection,
document id, status, and timestamp; signed requests include
`x-np-signature`. Plugin storage records bounded delivery diagnostics, while
Admin exposes last status and an approval-gated test delivery action.

The manifest explicitly declares outbound network and plugin-storage
capabilities. See [plugin capabilities](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-capabilities.md)
and [plugin hooks](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-hooks.md).

## License

MIT
