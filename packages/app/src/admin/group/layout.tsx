import { AdminThemeInit } from "./admin-theme-init";

/**
 * Admin route-group layout. Keeps admin-only theme state out of the
 * public site while avoiding raw script tags inside route layouts.
 */
export default function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminThemeInit />
      {children}
    </>
  );
}
