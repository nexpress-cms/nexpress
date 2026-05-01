import type { ReactNode } from "react";

import "./globals.css";

export const metadata = {
  title: "__NX_PROJECT_NAME__",
  description: "A NexPress project scaffolded with create-nexpress.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
