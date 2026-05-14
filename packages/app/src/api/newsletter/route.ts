import { NpValidationError } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";

/**
 * Newsletter subscribe stub.
 *
 * Themes ship a footer subscribe form that POSTs `{ email }` here.
 * The framework provides this stub so the form's golden path
 * (validate → confirm) works out of the box without an operator
 * having to wire anything. The handler only validates the email
 * shape and returns success — it does NOT actually deliver mail
 * or store the address.
 *
 * Operators replace this route in their app to call their mail
 * provider (Buttondown, ConvertKit, Resend, Mailchimp, etc.):
 *
 *   // apps/web/src/app/api/newsletter/route.ts
 *   export const dynamic = "force-dynamic";
 *   export async function POST(request: NextRequest) {
 *     const { email } = await request.json();
 *     await fetch("https://api.buttondown.email/v1/subscribers", { ... });
 *     return Response.json({ ok: true });
 *   }
 *
 * The matching client form contract (themes/default footer):
 *   - 200 OK            → "Thanks — you're subscribed."
 *   - 404               → "endpoint not configured."
 *   - !ok + { error }   → renders `error.message`
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

interface SubscribeBody {
  email: string;
}

function validateBody(raw: unknown): SubscribeBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }
  const { email } = raw as Record<string, unknown>;
  if (typeof email !== "string" || email.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "email", message: "Email is required" },
    ]);
  }
  if (email.length > EMAIL_MAX) {
    throw new NpValidationError("Invalid input", [
      { field: "email", message: "Email is too long" },
    ]);
  }
  if (!EMAIL_RE.test(email)) {
    throw new NpValidationError("Invalid input", [
      { field: "email", message: "Enter a valid email address" },
    ]);
  }
  return { email };
}

export async function POST(request: NextRequest) {
  try {
    const { email } = validateBody(await readJsonBody(request));
    if (process.env.NODE_ENV !== "production") {
      // Surfaces the address in dev logs so operators notice the
      // stub is wired and they need to plug in a real provider.
      console.info(`[newsletter] stub received subscribe: ${email}`);
    }
    return npSuccessResponse({ subscribed: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
