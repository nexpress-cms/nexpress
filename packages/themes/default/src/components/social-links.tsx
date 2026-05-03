/**
 * Social-link strip read from `process.env.NX_SOCIAL_*` so
 * sites can light up the footer icons without forking the theme.
 * Empty when no env vars are set — the column collapses cleanly.
 *
 * Recognized env vars:
 *   NX_SOCIAL_GITHUB    → https://github.com/<handle>
 *   NX_SOCIAL_TWITTER   → https://twitter.com/<handle> or x.com URL
 *   NX_SOCIAL_LINKEDIN  → company / personal URL
 *   NX_SOCIAL_MASTODON  → https://mastodon.social/@<handle>
 *   NX_SOCIAL_RSS       → defaults to /feed.xml; set explicit URL to override
 *   NX_SOCIAL_EMAIL     → mailto: address
 */

interface SocialLink {
  href: string;
  label: string;
  Icon: () => React.JSX.Element;
}

function buildLinks(): SocialLink[] {
  const links: SocialLink[] = [];
  const env = process.env;
  if (env.NX_SOCIAL_GITHUB) {
    links.push({ href: env.NX_SOCIAL_GITHUB, label: "GitHub", Icon: GithubIcon });
  }
  if (env.NX_SOCIAL_TWITTER) {
    links.push({ href: env.NX_SOCIAL_TWITTER, label: "Twitter / X", Icon: TwitterIcon });
  }
  if (env.NX_SOCIAL_LINKEDIN) {
    links.push({ href: env.NX_SOCIAL_LINKEDIN, label: "LinkedIn", Icon: LinkedInIcon });
  }
  if (env.NX_SOCIAL_MASTODON) {
    // Mastodon recommends rel="me" for verified profile links.
    links.push({ href: env.NX_SOCIAL_MASTODON, label: "Mastodon", Icon: MastodonIcon });
  }
  if (env.NX_SOCIAL_EMAIL) {
    const value = env.NX_SOCIAL_EMAIL.startsWith("mailto:")
      ? env.NX_SOCIAL_EMAIL
      : `mailto:${env.NX_SOCIAL_EMAIL}`;
    links.push({ href: value, label: "Email", Icon: EmailIcon });
  }
  // RSS is always useful — default to the framework's feed when
  // not overridden. The icon is the universal RSS mark.
  links.push({
    href: env.NX_SOCIAL_RSS ?? "/feed.xml",
    label: "RSS",
    Icon: RssIcon,
  });
  return links;
}

export function SocialLinks() {
  const links = buildLinks();
  if (links.length === 0) return null;
  return (
    <ul className="nx-site-footer-social">
      {links.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            aria-label={link.label}
            rel={link.label === "Mastodon" ? "me noopener noreferrer" : "noopener noreferrer"}
            target={link.href.startsWith("mailto:") || link.href.startsWith("/") ? undefined : "_blank"}
          >
            <link.Icon />
          </a>
        </li>
      ))}
    </ul>
  );
}

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function GithubIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...ICON_PROPS}>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...ICON_PROPS}>
      <path d="M22 4.01c-1 .49-1.98.689-3 .99-1.121-1.265-2.783-1.335-4.38-.737S11.977 6.323 12 8v1c-3.245.083-6.135-1.395-8-4 0 0-4.182 7.433 4 11-1.872 1.247-3.739 2.088-6 2 3.308 1.803 6.913 2.423 10.034 1.517 3.58-1.04 6.522-3.723 7.651-7.742a13.84 13.84 0 0 0 .497-3.753c-.002-.249 1.51-2.772 1.818-4.013z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...ICON_PROPS}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function MastodonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...ICON_PROPS}>
      <path d="M21 12c0 4.97-4.03 7-9 7s-9-2.03-9-7V8a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v4z" />
      <path d="M9 13V9.5a2.5 2.5 0 1 1 5 0V13" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...ICON_PROPS}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function RssIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...ICON_PROPS}>
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}
