# @nexpress/plugin-reading-time

Reading-time meta plugin for
[NexPress](https://github.com/hahabsw/nexpress). Stamps a
`readingMinutes` field onto documents in `content:beforeSave`.

## Install

```bash
pnpm add @nexpress/plugin-reading-time
```

## Usage

```ts
// nexpress.config.ts
import readingTime from "@nexpress/plugin-reading-time";

export default defineConfig({
  // ...
  plugins: [readingTime()],
});
```

Reads the document's rich-text body (or `body` plain text) and writes
`readingMinutes`. Add the field to the relevant collection if you
want it persisted:

```ts
defineCollection({
  // ...
  fields: [
    /* ... */
    { name: "readingMinutes", type: "number" },
  ],
});
```

## License

MIT
