import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

// Critically, this imports through the package's own `./client` export
// rather than the relative `./subscribe-form.js`. tsup would otherwise
// inline the entire SubscribeForm body into `dist/index.js`, which
// strips the `"use client"` boundary that Next.js looks for at module
// import time — the form would then attempt to render on the server
// and crash on `useState`. Self-package imports stay external in the
// bundle, so Next sees a real `import` line crossing into a client
// component module.
import { SubscribeForm } from "@nexpress/plugin-block-newsletter/client";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readListId(value: unknown): string {
  // Storage keys live under `subscriber:<listId>:<...>` so we limit `listId`
  // to a safe, single-segment identifier — no slashes, no spaces, no leading
  // dot. A misconfigured block-prop should never let an operator scribble
  // into another plugin's keyspace.
  if (typeof value !== "string") return "default";
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return "default";
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return "default";
  return trimmed;
}

function storageKey(listId: string, email: string): string {
  return `subscriber:${listId}:${email.toLowerCase()}`;
}

interface SubscriberRecord {
  email: string;
  listId: string;
  subscribedAt: string;
}

const newsletterBlock: NpBlockDefinition = {
  type: "newsletter.signup",
  label: "Newsletter signup",
  description: "Email signup form backed by plugin storage. Subscriber list keyed by `listId`.",
  icon: "✉️",
  defaultProps: {
    title: "Subscribe to the newsletter",
    subtitle: "Get new posts in your inbox.",
    listId: "default",
    buttonText: "Subscribe",
    placeholder: "you@example.com",
    successMessage: "Thanks — you're on the list.",
  },
  propsSchema: [
    { name: "title", label: "Title", type: "text", defaultValue: "Subscribe to the newsletter" },
    { name: "subtitle", label: "Subtitle", type: "textarea", defaultValue: "Get new posts in your inbox." },
    {
      name: "listId",
      label: "List id",
      type: "text",
      defaultValue: "default",
      description:
        "Slug-safe identifier (A-Z, 0-9, _, -). Subscribers are stored under `subscriber:<listId>:<email>`.",
    },
    { name: "buttonText", label: "Button text", type: "text", defaultValue: "Subscribe" },
    { name: "placeholder", label: "Email placeholder", type: "text", defaultValue: "you@example.com" },
    { name: "successMessage", label: "Success message", type: "text", defaultValue: "Thanks — you're on the list." },
  ],
  render: (props) => {
    const title = readString(props.title, "Subscribe to the newsletter");
    const subtitle = readString(props.subtitle, "");
    const listId = readListId(props.listId);
    const buttonText = readString(props.buttonText, "Subscribe");
    const placeholder = readString(props.placeholder, "you@example.com");
    const successMessage = readString(props.successMessage, "Thanks — you're on the list.");

    const wrapperStyle: CSSProperties = {
      padding: "1.5rem 1.75rem",
      margin: "1.5rem 0",
      borderRadius: "0.875rem",
      backgroundColor: "#f8fafc",
      border: "1px solid #e2e8f0",
    };

    return (
      <section className="np-block-newsletter" style={wrapperStyle}>
        {title.length > 0 ? (
          <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.25rem", color: "#0f172a" }}>{title}</h2>
        ) : null}
        {subtitle.length > 0 ? (
          <p style={{ margin: "0 0 1rem", color: "#475569", lineHeight: 1.55 }}>{subtitle}</p>
        ) : null}
        <SubscribeForm
          endpoint="/api/plugins/block-newsletter/subscribe"
          listId={listId}
          buttonText={buttonText}
          placeholder={placeholder}
          successMessage={successMessage}
        />
      </section>
    );
  },
};

export const newsletterPlugin = definePlugin({
  manifest: {
    id: "block-newsletter",
    version: "0.1.0",
    name: "Newsletter signup block",
    description: "Email signup block + plugin route + plugin storage subscriber list.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    // `api:route` is auto-derived from the `routes` array below by
    // `definePlugin`. We still have to spell out `storage:kv` because the
    // host can't tell from the definition top-level whether a route
    // handler will eventually call `ctx.storage.*` — auto-deriving that
    // would silently grant privilege the author didn't ask for.
    capabilities: ["storage:kv"],
  },
  blocks: [newsletterBlock],
  routes: [
    {
      method: "POST",
      path: "/subscribe",
      description: "Add an email to the plugin-storage subscriber list.",
      // Anonymous form-submit is the whole point of this block — site
      // visitors aren't logged in. The framework rate-limits the
      // catch-all to 30 req/min/IP, which is enough to keep a casual
      // abuser at bay; serious deployments should add a captcha + a
      // stricter limiter on top via plugin storage / a custom proxy.
      auth: false,
      handler: async (req, ctx) => {
        const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
        const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
        const listId = readListId(body.listId);

        if (rawEmail.length === 0) {
          return { status: 400, body: { ok: false, error: "Email is required." } };
        }
        if (rawEmail.length > 254 || !EMAIL_REGEX.test(rawEmail)) {
          return {
            status: 400,
            body: { ok: false, error: "That doesn't look like a valid email address." },
          };
        }

        const c = ctx as {
          storage: {
            get<T = unknown>(key: string): Promise<T | null>;
            set(key: string, value: unknown, opts?: { ttl?: number }): Promise<void>;
            has(key: string): Promise<boolean>;
          };
          log: { info: (m: string, d?: Record<string, unknown>) => void };
        };

        const key = storageKey(listId, rawEmail);
        if (await c.storage.has(key)) {
          // Idempotent — re-submitting the same email is fine.
          return {
            status: 200,
            body: { ok: true, message: "You're already subscribed." },
          };
        }

        const record: SubscriberRecord = {
          email: rawEmail,
          listId,
          subscribedAt: new Date().toISOString(),
        };
        await c.storage.set(key, record);
        c.log.info("Newsletter subscribe", { listId, emailHash: hashForLog(rawEmail) });

        return {
          status: 200,
          body: { ok: true, message: "Subscribed." },
        };
      },
    },
  ],
});

/**
 * Tiny non-cryptographic hash for log lines so we record signal ("a new
 * subscriber landed at 10:42") without writing the email to plaintext logs.
 * Subscriber rows themselves keep the full email — operators querying the
 * list need it. The hash is just for the audit-y "what happened" line.
 */
function hashForLog(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export default newsletterPlugin;
