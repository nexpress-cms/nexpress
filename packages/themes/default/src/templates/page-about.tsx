import type { NpTemplateRenderProps } from "@nexpress/theme";

export function PageAboutTemplate(_props: NpTemplateRenderProps) {
  return (
    <article className="np-default-about">
      <header className="np-default-about-hero">
        <span className="np-default-about-eyebrow">/about</span>
        <h1>Readable systems notes from people who keep production honest.</h1>
        <p className="np-default-about-lede">
          Equilibrium is the default NexPress demo publication: a clean,
          practical engineering journal for teams writing about infrastructure,
          product, and the decisions that survive real traffic.
        </p>
      </header>

      <section className="np-default-about-stats" aria-label="Publication stats">
        {[
          ["Posts", "68", "across 5 sections"],
          ["Subscribers", "14,200", "email, RSS, Atom"],
          ["Years writing", "7", "since Jan 2019"],
          ["Words shipped", "412k", "average 6k / post"],
        ].map(([label, value, sub]) => (
          <div className="np-default-about-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </section>

      <section className="np-default-about-split">
        <div className="np-default-about-prose">
          <p>
            We write for working engineers: the person debugging stale reads,
            reviewing a migration at midnight, or trying to explain why the
            simple queue became a contract between two systems.
          </p>
          <p>
            The default theme is intentionally quiet. It gives long-form posts a
            sharp header, useful archives, a durable newsletter slot, and enough
            typographic range to feel like a real publication without becoming a
            brand exercise.
          </p>
          <p>
            Use it as a blog, changelog, product journal, or team notebook. The
            seeded content is fictional, but the layout is production-shaped.
          </p>
        </div>
        <aside className="np-default-about-card" aria-label="Masthead">
          <h2>Masthead</h2>
          <dl>
            <div>
              <dt>Editor</dt>
              <dd>Anya Hartwell</dd>
            </div>
            <div>
              <dt>Engineering</dt>
              <dd>Mira Okafor</dd>
            </div>
            <div>
              <dt>Type & tools</dt>
              <dd>Jules Park</dd>
            </div>
            <div>
              <dt>Cadence</dt>
              <dd>One essay every other Tuesday</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="np-default-about-now">
        <div className="np-section-head">
          <h2>Now drafting</h2>
          <span className="np-section-head-meta">last updated · May 2026</span>
        </div>
        <div className="np-default-about-now-grid">
          {[
            ["Drafting", "The migration we ran 47 times", "72%"],
            ["Editing", "CTEs were never the problem", "95%"],
            ["Researching", "What latency budgets actually buy", "22%"],
          ].map(([state, title, progress]) => (
            <article className="np-default-about-now-card" key={title}>
              <span>{state}</span>
              <h3>{title}</h3>
              <div className="np-default-about-progress">
                <i style={{ inlineSize: progress }} />
              </div>
              <small>{progress}</small>
            </article>
          ))}
        </div>
      </section>
    </article>
  );
}
