# @nexpress/plugin-reading-time

Reading-time meta plugin for
[NexPress](https://github.com/nexpress-cms/nexpress). Logs a
word-count-based reading-time estimate whenever a post is created or
updated, and exposes a `GET /api/plugins/reading-time/estimate?text=…`
endpoint that returns the estimated minutes for ad-hoc text.

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
  plugins: [readingTime],
});
```

## Configuration

Open `/admin/plugins/reading-time` after the framework boots — the
auto-form (G.1) renders a single labeled input:

| Field            | Type   | Default | Range     |
|------------------|--------|---------|-----------|
| Words per minute | number | 220     | 50 – 800  |

Operator changes persist to `np_settings (key="plugin.config:reading-time")`
and are picked up by the next hook / route dispatch (no restart).

## License

MIT
