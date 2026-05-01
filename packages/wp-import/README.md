# @nexpress/wp-import

WordPress (WXR) importer for [NexPress](https://github.com/hahabsw/nexpress).
Ingests an exported WXR file end-to-end: WXR XML parsing, HTML → Lexical
conversion (including a Gutenberg block-fence parser), media download +
dedup, taxonomy/term mapping, comment threading, custom post types, an
audit log, and a resume marker for crash recovery.

## Install

```bash
pnpm add @nexpress/wp-import
```

## Usage

The importer drives a long-running pg-boss job — surface state through
the standard NexPress jobs admin (`/admin/jobs`). For the CLI entry
and the full guide:

- [docs/wordpress-import-guide.md](https://github.com/hahabsw/nexpress/blob/main/docs/wordpress-import-guide.md)
- [packages/wp-import/src/cli/](https://github.com/hahabsw/nexpress/tree/main/packages/wp-import/src/cli)

## Stability

Per the
[Stability section in AGENTS.md](https://github.com/hahabsw/nexpress/blob/main/AGENTS.md):
the CLI surface (`packages/wp-import/src/cli/`) is stable; the
`parse/` / `convert/` / `media/` / `apply/` modules are NOT a public
API — importing from them will break across versions.

## License

MIT
