/**
 * Default postcss config for NexPress consumers. Tailwind v4's
 * official PostCSS plugin is the only entry — every other layer
 * (autoprefixer, nesting, etc.) is handled inside the `@tailwindcss/postcss`
 * plugin itself.
 *
 * Re-exported as the literal config object so consumer
 * `postcss.config.mjs` can just `export { default } from
 * "@nexpress/app/config/postcss-config"` without the
 * `export default createPostcssConfig()` round-trip.
 */
const postcssConfig = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default postcssConfig;
