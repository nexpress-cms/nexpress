/**
 * Studio footer — three rows on a thin top rule:
 *   1. Contact line  (NX_SOCIAL_EMAIL → mailto, or generic blurb)
 *   2. Social mini-strip (NX_SOCIAL_GITHUB / TWITTER / LINKEDIN /
 *      MASTODON, all optional, hidden when none are configured)
 *   3. Colophon (year + framework credit)
 *
 * Stays minimal so the visual focus stays on the work above.
 */
export function PortfolioFooter() {
  const year = new Date().getFullYear();
  const email = process.env.NX_SOCIAL_EMAIL;
  const social = [
    { href: process.env.NX_SOCIAL_GITHUB, label: "GitHub" },
    { href: process.env.NX_SOCIAL_TWITTER, label: "Twitter" },
    { href: process.env.NX_SOCIAL_LINKEDIN, label: "LinkedIn" },
    { href: process.env.NX_SOCIAL_MASTODON, label: "Mastodon" },
    { href: process.env.NX_SOCIAL_DRIBBBLE, label: "Dribbble" },
    { href: process.env.NX_SOCIAL_INSTAGRAM, label: "Instagram" },
  ].filter((s): s is { href: string; label: string } => Boolean(s.href));

  return (
    <footer className="nx-site-footer nx-portfolio-footer">
      <div className="nx-portfolio-footer-inner">
        <div className="nx-portfolio-footer-contact">
          {email ? (
            <a
              href={email.startsWith("mailto:") ? email : `mailto:${email}`}
              className="nx-portfolio-footer-email"
            >
              {email.replace(/^mailto:/, "")}
            </a>
          ) : (
            <span className="nx-portfolio-footer-email">Available for select work</span>
          )}
        </div>
        {social.length > 0 ? (
          <ul className="nx-portfolio-footer-social">
            {social.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="nx-portfolio-footer-mark">
          © {year.toString()} · Built with NexPress
        </p>
      </div>
    </footer>
  );
}
