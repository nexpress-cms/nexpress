/**
 * Default theme header. Renders the site's logo, primary nav,
 * search box, and member status widget. The 11.1 ship just
 * exposes the slot; the apps/web layout still hardcodes the
 * structure — 11.2 wires the layout to read this from the
 * active theme.
 *
 * Themes that want a different header (e.g. centered logo,
 * mega-menu, sticky behavior) override `slots.header` in
 * their own `defineTheme()` call.
 */
export function DefaultHeader() {
  return (
    <header className="nx-site-header">
      <nav>
        <a href="/" className="nx-site-logo">
          NexPress
        </a>
      </nav>
    </header>
  );
}
