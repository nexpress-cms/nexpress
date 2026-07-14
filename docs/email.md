# Email delivery

NexPress uses a pluggable adapter for transactional email. Password-reset
and invite flows enqueue a job (`auth:sendPasswordReset`) which the
builtin handler forwards to whichever adapter you've installed. The
default adapter is a **no-op that logs the reset URL to stdout** — safe
for development, unusable for real deployments.

---

## Runtime contract

The public server API lives at `@nexpress/core/email`. `NP_EMAIL_ADAPTER`
accepts exactly three modes:

- unset, empty, or `noop` — install the logging no-op adapter;
- `smtp` — install the built-in SMTP adapter from the exact `NP_SMTP_*`
  contract below;
- `custom` — preserve an adapter installed programmatically with
  `setEmailAdapter()`.

Aliases such as `resend` are not adapter modes. Use `smtp` for a provider's
SMTP endpoint or `custom` for its native SDK. NexPress parses this contract on
the first `ensureFor(...)` call, including read bootstraps, so an unknown mode,
malformed port, malformed boolean, missing sender, or half-configured SMTP
credential pair fails before the application begins serving requests. `pnpm
run doctor` reports the same parser as `email.contract`; `/admin/health` also
verifies that `custom` mode has a live adapter.

Every delivery goes through `sendEmail()`. It accepts an exact, bounded
`{ to, subject, text, html?, from? }` object for one recipient, rejects unknown
fields and header injection, and requires the adapter's promise to resolve to
`void`. `setEmailAdapter()` validates the adapter's canonical lowercase `kind`
and `send` function at registration. Web writes and dedicated workers both
install the same resolved config; `ensureFor("worker")` deliberately wires
email without starting a competing enqueue-only pg-boss producer.

---

## Built-in SMTP adapter (recommended)

Works with any SMTP-speaking provider (Resend, SES, Mailgun, Postmark,
Gmail, Zoho, a custom relay). Enable it by setting:

```dotenv
NP_EMAIL_ADAPTER=smtp
NP_SMTP_HOST=smtp.resend.com
NP_SMTP_PORT=587
NP_SMTP_USER=resend
NP_SMTP_PASS=<api-key-or-password>
NP_SMTP_FROM="NexPress <noreply@yourdomain.com>"
NP_SMTP_SECURE=false
```

`NP_SMTP_HOST` and `NP_SMTP_FROM` are required. `NP_SMTP_PORT` defaults to
`587` and must be a base-10 integer from 1 through 65535. `NP_SMTP_SECURE`
defaults to `true` only for port 465; when present it must be exactly `true` or
`false`. `NP_SMTP_USER` and `NP_SMTP_PASS` are optional but must appear
together. Use secure mode for implicit TLS (normally 465) and false for
STARTTLS ports (normally 587 / 25). Apps using the adapter must include
`nodemailer` in their dependencies — it's an optional peer of
`@nexpress/core`.

### Local development — Mailpit

`docker/docker-compose.yml` ships a Mailpit service that boots
alongside Postgres. Use it to capture every email the app sends
during development without hitting a real provider:

```bash
docker compose -f docker/docker-compose.yml up -d
# Mailpit is now listening:
#   SMTP        :1025
#   Web inbox   http://localhost:8025
```

Point `.env` at it (this is the default in `.env.example`):

```dotenv
NP_EMAIL_ADAPTER=smtp
NP_SMTP_HOST=localhost
NP_SMTP_PORT=1025
NP_SMTP_USER=dev
NP_SMTP_PASS=dev
NP_SMTP_FROM="NexPress dev <noreply@nexpress.local>"
NP_SMTP_SECURE=false
```

> **Scaffolded site (Track A):** one `.env` at the project root —
> `pnpm run setup` writes it. Done.
>
> **Monorepo (Track B):** two `.env` files, both need this. Next.js
> reads `.env` from the project root (`apps/web/`), but monorepo-level
> scripts like `drizzle.config.ts` load the repo-root `.env` directly
> via dotenv. The SMTP block has to live in **`apps/web/.env`** for
> `next dev` to see it; root `.env` only matters for monorepo tooling.
> `pnpm run setup` writes both automatically — manual setups need to
> copy the block into `apps/web/.env` after `cp .env.example .env`.

The `MP_SMTP_AUTH_ACCEPT_ANY` flag on the container accepts any
credentials, so you don't need to provision a real SMTP user
during dev. Trigger an email (register, forgot-password) and
the message appears in the inbox at `http://localhost:8025` —
including raw headers, HTML render, and plain-text version.

Switching to a real provider for staging / production is just replacing the
`NP_SMTP_*` values; the application code path is identical.

### Provider examples

**Resend**

```dotenv
NP_SMTP_HOST=smtp.resend.com
NP_SMTP_PORT=465
NP_SMTP_USER=resend
NP_SMTP_PASS=re_your_api_key
NP_SMTP_FROM="NexPress <onboarding@resend.dev>"
NP_SMTP_SECURE=true
```

**AWS SES (SMTP interface)**

```dotenv
NP_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
NP_SMTP_PORT=587
NP_SMTP_USER=<SES SMTP Username>
NP_SMTP_PASS=<SES SMTP Password>
NP_SMTP_FROM="NexPress <noreply@yourdomain.com>"
NP_SMTP_SECURE=false
```

**Mailgun**

```dotenv
NP_SMTP_HOST=smtp.mailgun.org
NP_SMTP_PORT=587
NP_SMTP_USER=postmaster@mg.yourdomain.com
NP_SMTP_PASS=<mailgun-smtp-password>
NP_SMTP_FROM="NexPress <noreply@mg.yourdomain.com>"
NP_SMTP_SECURE=false
```

**Gmail** (app passwords; not for production volume)

```dotenv
NP_SMTP_HOST=smtp.gmail.com
NP_SMTP_PORT=465
NP_SMTP_USER=you@gmail.com
NP_SMTP_PASS=<app-password>
NP_SMTP_FROM="NexPress <you@gmail.com>"
NP_SMTP_SECURE=true
```

---

## Custom adapters

Any adapter implementing `NpEmailAdapter` works. Use this when your
provider has a native HTTP SDK (Resend, SendGrid, Postmark) that you'd
rather call directly than go through SMTP.

```ts
// src/lib/install-email-adapter.ts — server-only
import { setEmailAdapter, type NpEmailAdapter, type NpEmailMessage } from "@nexpress/core/email";
import { Resend } from "resend";

class ResendAdapter implements NpEmailAdapter {
  readonly kind = "resend";
  private client: Resend;
  private from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async send(msg: NpEmailMessage) {
    await this.client.emails.send({
      from: msg.from ?? this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}

export function installEmailAdapter(): void {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required for the custom email adapter");
  }
  setEmailAdapter(new ResendAdapter(process.env.RESEND_API_KEY, "noreply@yourdomain.com"));
}
```

Set `NP_EMAIL_ADAPTER=custom`, then call the installer from
`src/nexpress.config.ts` before exporting `defineConfig(...)`:

```ts
import { installEmailAdapter } from "./lib/install-email-adapter";

installEmailAdapter();
```

The config module is part of every NexPress bootstrap, including packaged
route handlers. The scaffolded `src/lib/init-core.ts` is only a thin re-export
and is not a reliable custom-registration hook. Custom registration must exist
before `ensureFor("worker")` or the first `ensureFor("write")`; otherwise
bootstrap fails instead of silently retaining the no-op adapter.

---

## Templates

The handlers call `buildInviteEmail`, `buildResetEmail`, and
`buildMemberVerifyEmail` from `@nexpress/core/email` to construct exact
`{ subject, text, html }` templates. They use an inline HTML shell that renders
reliably in most webmail clients. Password templates take:

- `siteName` — populated from `NpConfig.site.name`.
- `name` — the recipient's display name.
- `resetUrl` — the full URL including the one-time token.
- `expiresAt` — the canonical UTC ISO timestamp from the issued credential.

Member verification uses the equivalent `displayName`, `verifyUrl`, and
`expiresAt` fields. The rendered copy shows the exact UTC expiration rather
than a hard-coded duration, so changing `NP_INVITE_TTL_HOURS`,
`NP_RESET_TTL_MINUTES`, or `NP_VERIFY_TTL_HOURS` cannot make the message
disagree with the credential. Auth email jobs carry that timestamp and the
credential URL; they do not queue a second redundant raw-token field.

Override the copy by replacing the handler entirely:

```ts
import { configureBuiltinJobContext } from "@nexpress/core";

configureBuiltinJobContext({
  sendPasswordReset: async (data) => {
    // Your own template rendering + adapter call. Throw on failure so
    // pg-boss retries per its configured policy.
  },
});
```

---

## Local development

Leave `NP_EMAIL_ADAPTER` unset and the handler falls back to
`NoopEmailAdapter`, which prints:

```
[nexpress] email (noop adapter) — not actually delivered.
  to:      alice@example.com
  subject: Reset your NexPress Reference password
  text:
    Hi alice@example.com,
    ...
```

Copy the URL from the log and complete the flow manually. No SMTP
credentials needed.

---

## Deliverability

- Set up SPF + DKIM on your sending domain. Providers have their own
  records — follow their docs.
- Use a dedicated subdomain (e.g. `mail.yoursite.com`) to isolate
  transactional reputation from marketing.
- Monitor bounces / complaints at the provider; repeated bounces can
  throttle future sends.
