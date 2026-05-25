import { npThemeInitScript } from "@nexpress/admin";
import Script from "next/script";

/**
 * Admin route-group layout. The only thing it does today is mount
 * the admin theme bootstrap without rendering a raw <script> tag
 * from a React component. The script body is tiny and side-effect-only.
 */
export default function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        id="np-admin-theme-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: npThemeInitScript }}
      />
      {children}
    </>
  );
}
