import { ThemeInit } from "@nexpress/admin";

/**
 * Admin route-group layout. The only thing it does today is mount
 * <ThemeInit /> so the inline theme bootstrap script runs before
 * the admin shell paints — without it, switching from a light page
 * into an operator's dark-preference admin session would flash
 * white for a beat. The script body is tiny and side-effect-only.
 */
export default function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ThemeInit />
      {children}
    </>
  );
}
