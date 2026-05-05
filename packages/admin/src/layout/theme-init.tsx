import * as React from "react";

const STORAGE_KEY = "np-theme";

export function ThemeInit(): React.JSX.Element {
  const script = `
(function() {
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: script }} suppressHydrationWarning />;
}
