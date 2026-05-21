import type { NpTemplateRenderProps } from "@nexpress/theme";

export function PageMastheadTemplate(_props: NpTemplateRenderProps) {
  const editors = [
    ["Editor in chief", "Marius Kemp", "Long-form editor, former city-desk reporter."],
    ["Deputy editor", "Ines Marsh", "Profiles, essays, and the letters section."],
    ["Art director", "Anne Falk", "Print systems, covers, and issue rhythm."],
    ["Photo editor", "Helena Park", "Portrait commissions and archive recovery."],
  ];

  return (
    <article className="np-magazine-masthead">
      <header className="np-magazine-masthead-hero">
        <p>About · The masthead</p>
        <h1>A small review, in the long tradition.</h1>
        <span>
          Published every other Sunday from Seoul and New York: reporting,
          profiles, essays, photography, and patient editorial work.
        </span>
      </header>

      <section className="np-magazine-masthead-manifesto">
        <p>
          The Northbound Review was founded in 2014 above a bookstore in
          Hapjeong-dong. We still edit for the same thing: pieces that can sit
          on a desk for a month and remain useful when the week has moved on.
        </p>
        <p>
          We commission slowly, pay on acceptance, edit lightly, and publish in
          issues rather than feeds. The web edition runs on NexPress; the print
          edition still ships by post.
        </p>
      </section>

      <section className="np-magazine-masthead-editors" aria-label="Editors">
        <div className="np-magazine-section-head">
          <h2>The room</h2>
          <span>4 editors · est. 2014</span>
        </div>
        <div className="np-magazine-masthead-grid">
          {editors.map(([role, name, bio], index) => (
            <article className="np-magazine-masthead-editor" key={name}>
              <div data-initials={name.split(" ").map((p) => p[0]).join("")} />
              <span>{role}</span>
              <h3>{name}</h3>
              <p>{bio}</p>
              <small>edited {(312 - index * 44).toString()} · since {2014 + index}</small>
            </article>
          ))}
        </div>
      </section>
    </article>
  );
}
