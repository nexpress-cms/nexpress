import { ThemeEditor, ThemeSettingsPanel } from "@nexpress/admin/client";
import { getActiveTheme } from "@nexpress/core";

import { ensureFor } from "../../../../lib/init-core";

export const dynamic = "force-dynamic";

export default async function ThemeSettingsPage() {
  await ensureFor("read");
  const active = await getActiveTheme();
  // The settings panel renders only when there's an active
  // theme; it self-handles the "no settings" case (themes
  // without a settingsSchema produce an empty form). Resolving
  // server-side avoids a client round-trip just to learn the id.
  return (
    <div className="space-y-6">
      <ThemeEditor />
      {active ? <ThemeSettingsPanel themeId={active.manifest.id} /> : null}
    </div>
  );
}
