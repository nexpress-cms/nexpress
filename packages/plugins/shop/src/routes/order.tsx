import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { npRequireShopOrderId } from "../order-contract.js";
import { getShopMessages, resolveShopSkin, type NpShopRuntime } from "../runtime.js";
import { ShopOrderSurface } from "../skins/shared.js";

export function createShopOrderRoute(runtime: NpShopRuntime) {
  return async function ShopOrderRoute({ params }: NpRouteRenderProps) {
    let orderId: string;
    try {
      orderId = npRequireShopOrderId(params.orderId);
    } catch {
      notFound();
    }
    const messages = await getShopMessages();
    const skin = resolveShopSkin(runtime);
    const paymentAction = runtime.paymentInitiationAdapter?.renderPaymentLauncher({
      attemptApiPath: "/api/plugins/shop/payments/attempts",
      orderId,
      label: messages.orderPay ?? "Pay with configured provider",
      preparingLabel: messages.orderPaymentPreparing ?? "Preparing secure payment…",
      confirmingLabel: messages.orderPaymentConfirming ?? "Confirming payment with the provider…",
      retryLabel: messages.orderPaymentRetry ?? "Prepare another payment attempt",
      failedLabel:
        messages.orderPaymentStartFailed ??
        "Payment could not be started or confirmed. The order remains pending.",
    });
    const props = {
      basePath: runtime.basePath,
      apiPath: "/api/plugins/shop/orders",
      returnApiPath: "/api/plugins/shop/returns",
      exchangeDestinationApiPath: "/api/plugins/shop/exchanges/destination",
      ...(runtime.carrierReturnLogisticsAdapter
        ? { returnLogisticsApiPath: "/api/plugins/shop/returns/logistics" }
        : {}),
      ...(runtime.carrierReturnPostageAdapter
        ? { returnPostageApiPath: "/api/plugins/shop/returns/postage" }
        : {}),
      ...(runtime.carrierReturnLabelAdapter
        ? { returnLogisticsLabelPath: "/api/plugins/shop/returns/logistics/label" }
        : {}),
      orderId,
      paymentAction,
      messages,
    };
    return skin.renderOrder?.(props) ?? <ShopOrderSurface {...props} skin={skin.id} />;
  };
}
