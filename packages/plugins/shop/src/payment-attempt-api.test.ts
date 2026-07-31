import { beforeEach, describe, expect, it, vi } from "vitest";

import { createShopPaymentAttemptApiHandler } from "./payment-attempt-api.js";

const prepare = vi.fn();
const confirm = vi.fn();
const read = vi.fn();

vi.mock("./payment-attempt-service.js", () => ({
  npPrepareShopPaymentAttempt: (...args: unknown[]) => prepare(...args),
  npConfirmShopPaymentAttempt: (...args: unknown[]) => confirm(...args),
  npReadShopPaymentAttempt: (...args: unknown[]) => read(...args),
}));

vi.mock("./request-identity.js", () => ({
  npResolveShopRequestIdentity: () => ({
    owner: { kind: "guest", id: "guest-id" },
    responseCookie: null,
  }),
  npShopRequestCsrfToken: () => "csrf-token",
  npRequireShopMutationCsrf: (request: { headers: Record<string, string> }) => {
    if (request.headers["x-csrf-token"] !== "csrf-token") throw new Error("csrf");
  },
}));

const orderId = "123e4567-e89b-42d3-a456-426614174000";
const attemptId = "223e4567-e89b-42d3-a456-426614174000";

const runtime = {
  paymentInitiationAdapter: {
    id: "test-pay",
    verifyWebhook: () => null,
    preparePayment: () => ({ kind: "client", data: {} }),
    confirmPayment: () => null,
    renderPaymentLauncher: () => null,
  },
} as never;

function request(method: string, body?: unknown, query: Record<string, string> = {}) {
  return {
    method,
    path: "/payments/attempts",
    params: {},
    query,
    body,
    headers: { "x-csrf-token": "csrf-token" },
  } as never;
}

describe("Shop payment attempt API", () => {
  beforeEach(() => {
    prepare.mockReset();
    confirm.mockReset();
    read.mockReset();
  });

  it("returns a mutation token without creating a payment attempt", async () => {
    const response = await createShopPaymentAttemptApiHandler(runtime)(request("GET"));
    expect(response).toMatchObject({
      status: 200,
      body: { attempt: null, csrfToken: "csrf-token" },
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("validates and forwards exact prepare and confirmation mutations", async () => {
    prepare.mockResolvedValue({ id: attemptId });
    confirm.mockResolvedValue({ attempt: { id: attemptId }, order: { id: orderId } });
    const handler = createShopPaymentAttemptApiHandler(runtime);
    expect((await handler(request("POST", { idempotencyKey: attemptId, orderId }))).status).toBe(
      200,
    );
    expect(prepare).toHaveBeenCalledWith(runtime, expect.objectContaining({ kind: "guest" }), {
      idempotencyKey: attemptId,
      orderId,
    });
    expect(
      (
        await handler(
          request("PATCH", {
            attemptId,
            orderId,
            confirmation: { paymentKey: "pay_123", amount: 25_000 },
          }),
        )
      ).status,
    ).toBe(200);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("requires both lookup ids and rejects unsupported request keys", async () => {
    const handler = createShopPaymentAttemptApiHandler(runtime);
    expect((await handler(request("GET", undefined, { orderId }))).status).toBe(400);
    expect(
      (await handler(request("POST", { idempotencyKey: attemptId, orderId, amountMinor: 1 })))
        .status,
    ).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });
});
