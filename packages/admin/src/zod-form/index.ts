/**
 * Phase F.3 — admin auto-form generator.
 *
 * Renders a form from `NpThemeSettingsField[]` metadata
 * (introspected server-side from a theme's Zod settingsSchema)
 * without requiring zod in the browser bundle.
 *
 * G.1 — also drives plugin config forms
 * (`packages/core/src/plugins/config.ts`); the metadata shape
 * is shared since both surfaces produce the same JSON.
 */

export { ZodForm, type ZodFormProps, type ZodFormValue } from "./form-renderer.js";
