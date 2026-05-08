# Email delivery

NexPress uses a pluggable adapter for transactional email. Password-reset
and invite flows enqueue a job (`auth:sendPasswordReset`) which the
builtin handler forwards to whichever adapter you've installed. The
default adapter is a **no-op that logs the reset URL to stdout** — safe
for development, unusable for real deployments.

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

`NP_SMTP_SECURE=true` for implicit-TLS ports (465). Leave it `false` for
STARTTLS ports (587 / 25). Apps using the adapter must include
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

The `MP_SMTP_AUTH_ACCEPT_ANY` flag on the container accepts any
credentials, so you don't need to provision a real SMTP user
during dev. Trigger an email (register, forgot-password) and
the message appears in the inbox at `http://localhost:8025` —
including raw headers, HTML render, and plain-text version.

Switching to a real provider for staging / production is just
swapping the four `NP_SMTP_*` values; the application code path
is identical.

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
// apps/web/src/lib/init-core.ts
import { setEmailAdapter, type NpEmailAdapter, type NpEmailMessage } from "@nexpress/core";
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

if (process.env.RESEND_API_KEY) {
  setEmailAdapter(
    new ResendAdapter(process.env.RESEND_API_KEY, "noreply@yourdomain.com"),
  );
}
```

Call `setEmailAdapter` **before** the first password-reset / invite
request — the reference app wires it inside `ensureFor("write")`
(see `apps/web/src/lib/init-core.ts`). Any module-scope init that
runs on boot also works.

---

## Templates

The handler calls `buildInviteEmail` / `buildResetEmail` from
`@nexpress/core` to construct `{ subject, text, html }`. Both use an
inline HTML shell that renders reliably in most webmail clients and
takes three variables:

- `siteName` — populated from `NpConfig.site.name`.
- `name` — the recipient's display name.
- `resetUrl` — the full URL including the one-time token.

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
