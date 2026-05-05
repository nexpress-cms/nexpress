import type { ReactNode } from "react";

import { NpThemeStyle } from "@nexpress/theme";
import { getTheme } from "@nexpress/core";

import { ensureFor } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  await ensureFor("read");
  const theme = await getTheme();

  return (
    <>
      <NpThemeStyle theme={theme} />
      <header className="border-b px-6 py-4">
        <div className="mx-auto max-w-5xl text-lg font-semibold">__NX_PROJECT_NAME__</div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
    </>
  );
}
