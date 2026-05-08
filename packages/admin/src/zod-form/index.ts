/**
 * Phase F.3 — admin auto-form generator.
 *
 * Renders a form from `NpThemeSettingsField[]` metadata
 * (introspected server-side from a theme's Zod settingsSchema)
 * without requiring zod in the browser bundle.
 *
 * Used by the theme settings panel today; plugin config UIs
 * will migrate as a follow-up (design doc §4.3 deferred list).
 */

export { ZodForm, type ZodFormProps, type ZodFormValue } from "./form-renderer.js";
