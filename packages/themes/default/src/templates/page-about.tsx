import type { NpTemplateRenderProps } from "@nexpress/theme";

export function PageAboutTemplate(_props: NpTemplateRenderProps) {
  return (
    <article className="np-default-about">
      <header className="np-default-about-hero">
        <span className="np-default-about-eyebrow">/about</span>
        <h1>
          A small place for <em>long thoughts</em> on the parts of the stack that don't fit in a
          tweet.
        </h1>
        <p className="np-default-about-lede">
          Equilibrium is a working journal by Anya Hartwell and a rotating group of engineers
          writing about production systems, databases, language design, and the trade-offs that only
          show up after launch.
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
            We are interested in the parts that sound boring in architecture diagrams and become
            very loud at 2:13 a.m.: replicas, queues, migrations, type boundaries, observability,
            and the social contract around changing shared systems.
          </p>
          <p>
            Most posts begin as internal notes. We rewrite them until the production detail is still
            intact but the lesson travels: what broke, what fixed it, what we would avoid next time.
          </p>
          <p>
            The archive is fictional demo content, but the editorial model is real enough to
            exercise the theme: long-form essays, short notes, topic archives, a durable newsletter
            slot, and a quiet masthead.
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
              <dd>Lukas Berg</dd>
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
