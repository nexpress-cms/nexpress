# @nexpress/plugin-block-newsletter

End-to-end newsletter example combining a page-builder block, typed plugin API
route, plugin-scoped storage, logging, and capability declarations.

```bash
pnpm exec nexpress plugin add @nexpress/plugin-block-newsletter
```

The block configures copy and a list id. Its `POST /subscribe` plugin route
validates and deduplicates email addresses before storing subscriber records;
logs retain only a non-cryptographic email hash. See
[plugin API routes](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-api-routes.md).

## License

MIT
