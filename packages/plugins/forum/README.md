# @nexpress/plugin-forum

Forum plugin for [NexPress](https://github.com/hahabsw/nexpress) —
threaded discussions on top of the community surface (comments,
reactions, follows, mentions).

## Install

```bash
pnpm add @nexpress/plugin-forum
```

## Usage

```ts
// nexpress.config.ts
import forum from "@nexpress/plugin-forum";

export default defineConfig({
  // ...
  plugins: [forum()],
});
```

For the plugin model and extension points, see
[`@nexpress/plugin-sdk`](https://www.npmjs.com/package/@nexpress/plugin-sdk).

## License

MIT
