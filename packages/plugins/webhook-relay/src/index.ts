import { createHmac } from "node:crypto";

import {
  definePlugin,
  npAdminActionError,
  npAdminStatus,
  type NpPluginContext,
} from "@nexpress/plugin-sdk";
import { z } from "zod";

const configSchema = z.object({
  endpointUrl: z.string().url().optional().describe("Webhook endpoint URL"),
  signingSecret: z
    .string()
    .optional()
    .describe("Optional HMAC signing secret")
    .meta({ sensitive: true }),
  includeDrafts: z.boolean().default(false).describe("Send draft document events"),
  timeoutMs: z.number().int().min(500).max(30000).default(5000).describe("Request timeout"),
});

export type WebhookRelayConfig = z.infer<typeof configSchema>;

export interface WebhookRelayPayload {
  event: string;
  collection: string;
  documentId: string | null;
  status: string | null;
  at: string;
}

type HookData = Record<string, unknown> & {
  collection?: string;
  doc?: Record<string, unknown>;
};

function pickDoc(data: HookData): Record<string, unknown> {
  return data.doc && typeof data.doc === "object" ? data.doc : data;
}

export function buildPayload(event: string, data: HookData): WebhookRelayPayload {
  const doc = pickDoc(data);
  const id = typeof doc.id === "string" ? doc.id : null;
  const status = typeof doc.status === "string" ? doc.status : null;
  const collection = typeof data.collection === "string" ? data.collection : "unknown";

  return {
    event,
    collection,
    documentId: id,
    status,
    at: new Date().toISOString(),
  };
}

export function signPayload(payload: WebhookRelayPayload, secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

export const webhookRelayPlugin = definePlugin<WebhookRelayConfig>({
  manifest: {
    id: "webhook-relay",
    version: "0.1.0",
    name: "Webhook Relay",
    description:
      "Relays content lifecycle events to a configured webhook endpoint and exposes admin delivery diagnostics.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    allowedHosts: ["*"],
    capabilities: ["network:fetch", "storage:kv"],
    agent: {
      description:
        "Integration plugin example that combines content hooks, outbound fetch, plugin storage, and declarative admin widgets.",
      category: "integration",
      tags: ["webhook", "integration", "content-hooks", "admin"],
    },
  },
  configSchema,
  hooks: {
    "content:afterCreate": ({ data, ctx }) => deliver("content:afterCreate", data, ctx),
    "content:afterUpdate": ({ data, ctx }) => deliver("content:afterUpdate", data, ctx),
    "content:afterDelete": ({ data, ctx }) => deliver("content:afterDelete", data, ctx),
  },
  actions: {
    lastDelivery: {
      kind: "status",
      handler: async (_data, ctx) => {
        const last = await ctx.storage.get<{ ok: boolean; message: string }>("last-delivery");
        return last
          ? npAdminStatus(last.ok ? "ok" : "warn", last.message)
          : npAdminStatus("warn", "No deliveries recorded yet.");
      },
    },
    sendTest: {
      kind: "action",
      handler: async (_data, ctx) => {
        const result = await deliver(
          "webhook:test",
          { collection: "test", doc: { id: "test", status: "published" } },
          ctx,
        );
        return result.ok ? { ok: true, data: result.message } : npAdminActionError(result.message);
      },
    },
  },
  admin: {
    widgets: [
      {
        id: "last-delivery",
        label: "Last delivery",
        kind: "status",
        actionId: "lastDelivery",
      },
    ],
    actions: [
      {
        id: "test-delivery",
        label: "Send test delivery",
        actionId: "sendTest",
        confirm: "Send a test webhook delivery now?",
      },
    ],
  },
});

async function deliver(
  event: string,
  data: Record<string, unknown>,
  ctx: Pick<NpPluginContext<WebhookRelayConfig>, "config" | "http" | "storage" | "log">,
): Promise<{ ok: boolean; message: string }> {
  const payload = buildPayload(event, data);

  if (!ctx.config.includeDrafts && payload.status === "draft") {
    return { ok: true, message: "Skipped draft document." };
  }

  if (!ctx.config.endpointUrl) {
    const message = "Webhook endpoint is not configured.";
    await ctx.storage.set("last-delivery", { ok: false, message }, { ttl: 30 * 24 * 60 * 60 });
    return { ok: false, message };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ctx.config.signingSecret) {
    headers["x-np-signature"] = signPayload(payload, ctx.config.signingSecret);
  }

  const res = await ctx.http.fetch(ctx.config.endpointUrl, {
    method: "POST",
    headers,
    body: { ...payload },
    timeoutMs: ctx.config.timeoutMs,
  });
  const ok = res.ok;
  const message = ok ? `Delivered ${payload.event}` : `Endpoint returned HTTP ${res.status}`;
  await ctx.storage.set(
    "last-delivery",
    { ok, message, at: payload.at },
    { ttl: 30 * 24 * 60 * 60 },
  );

  if (!ok) {
    ctx.log.warn("Webhook delivery failed", { status: String(res.status), event: payload.event });
  }

  return { ok, message };
}

export default webhookRelayPlugin;
