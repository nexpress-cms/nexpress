import type { NpTemplateRenderProps } from "@nexpress/theme";

const RELEASES = [
  {
    version: "0.3.6",
    date: "May 2026",
    tag: "latest",
    changes: [
      ["Improved", "Theme seed content now owns first-boot pages and posts per active theme."],
      ["Added", "Built-in theme docs, magazine, and portfolio front-page render coverage."],
      ["Fixed", "Theme-contributed fields are gated by active theme in the admin editor."],
    ],
  },
  {
    version: "0.3.0",
    date: "May 2026",
    tag: "theme v0.2",
    changes: [
      ["Added", "Theme routes, archives, nav locations, settings schema, and patterns."],
      ["Added", "Docs and portfolio kinds on the universal posts collection."],
      ["Breaking", "Legacy nx prefix moved to np across framework-owned identifiers."],
    ],
  },
  {
    version: "0.2.0",
    date: "April 2026",
    tag: "pre-1.0",
    changes: [
      ["Added", "Plugin page routes and page-builder block contributions."],
      ["Improved", "pg-boss worker lifecycle and admin jobs surface."],
      ["Fixed", "CSRF and rate limiting now live in the app proxy boundary."],
    ],
  },
];

export function PageChangelogTemplate(_props: NpTemplateRenderProps) {
  return (
    <article className="np-docs-changelog-page">
      <header className="np-docs-changelog-hero">
        <p>Changelog</p>
        <h1>Every shipped change, in reverse.</h1>
        <span>Pre-1.0 packages use minor releases for breaking changes.</span>
      </header>

      <ol className="np-docs-changelog-timeline">
        {RELEASES.map((release) => (
          <li className="np-docs-changelog-release" key={release.version}>
            <aside>
              <strong>v{release.version}</strong>
              <span>{release.date}</span>
              <i>{release.tag}</i>
            </aside>
            <div>
              {release.changes.map(([kind, text]) => (
                <p key={`${release.version}-${text}`}>
                  <span data-kind={kind.toLowerCase()}>{kind}</span>
                  {text}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
