import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PACKING_WORK_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_PACKING_WORK_CANCEL_RESULT_CONTRACT,
  NP_SHOP_PACKING_WORK_CREATE_REQUEST_CONTRACT,
  NP_SHOP_PACKING_WORK_CREATE_RESULT_CONTRACT,
  NP_SHOP_PACKING_WORK_STORAGE_CONTRACT,
  NpShopPackingWorkContractError,
  NpShopPackingWorkProviderError,
  NpShopPackingWorkUnavailableError,
  npAnalyzeShopPackingWorkCancelRequest,
  npAnalyzeShopPackingWorkCancelResultForRequest,
  npAnalyzeShopPackingWorkCreateRequest,
  npAnalyzeShopPackingWorkCreateResultForRequest,
  npAnalyzeShopPackingWorkFingerprintSource,
  npAnalyzeStoredShopPackingWork,
  npCreateShopPackingWorkCancelResult,
  npCreateShopPackingWorkCreateResult,
  npRequireShopExchangePackingWorkCreateInput,
  npRequireShopFulfillmentPackingWorkCreateInput,
  npRequireShopPackingWorkExistingActionInput,
  npRequireShopPackingWorkCancelResult,
  npRequireShopPackingWorkCreateResult,
  npRequireShopPackingWorkParcelFingerprint,
  npRequireShopPackingWorkProviderId,
  npSerializeShopPackingWorkFingerprintSource,
  npShopPackingWorkLimits,
  npShopPackingWorkStatuses,
  npShopPackingWorkStorageKey,
  type NpShopPackingWorkAdapter,
  type NpShopPackingWorkCancelRequest,
  type NpShopPackingWorkCreateRequest,
  type NpShopPackingWorkLine,
  type NpShopPackingWorkParcel,
  type NpShopStoredPackingWork,
} from "./packing-contract.js";

const WORK_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const EXCHANGE_ID = "33333333-3333-4333-8333-333333333333";
const CANCELLATION_ID = "44444444-4444-4444-8444-444444444444";
const SHIPMENT_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const FINGERPRINT = "a".repeat(64);
const REQUESTED_AT = "2026-08-11T00:00:00.000Z";
const CONFIRMED_AT = "2026-08-11T00:00:01.000Z";
const ACTIVATED_AT = "2026-08-11T00:00:02.000Z";
const CANCEL_REQUESTED_AT = "2026-08-11T00:00:03.000Z";
const CANCELLED_AT = "2026-08-11T00:00:04.000Z";
const UPDATED_AT = "2026-08-11T00:00:05.000Z";
const PURGE_AT = "2026-09-10T00:00:05.000Z";

const lines: readonly NpShopPackingWorkLine[] = [
  {
    lineKey: "line-1",
    productId: PRODUCT_ID,
    productSlug: "sample-product",
    variantSku: "BLUE-L",
    quantity: 2,
  },
];

const parcels: readonly NpShopPackingWorkParcel[] = [
  {
    id: "box-1",
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    weightGrams: 1_500,
    items: [{ lineKey: "line-1", quantity: 2 }],
  },
];

function createRequest(
  overrides: Readonly<Record<string, unknown>> = {},
): NpShopPackingWorkCreateRequest {
  return {
    contract: NP_SHOP_PACKING_WORK_CREATE_REQUEST_CONTRACT,
    workId: WORK_ID,
    orderId: ORDER_ID,
    target: "outbound",
    exchangeId: null,
    sourceRevision: 3,
    parcelRevision: 2,
    parcelFingerprint: FINGERPRINT,
    lines,
    parcels,
    requestedAt: REQUESTED_AT,
    ...overrides,
  };
}

function cancelRequest(
  overrides: Partial<NpShopPackingWorkCancelRequest> = {},
): NpShopPackingWorkCancelRequest {
  return {
    contract: NP_SHOP_PACKING_WORK_CANCEL_REQUEST_CONTRACT,
    cancellationId: CANCELLATION_ID,
    workId: WORK_ID,
    orderId: ORDER_ID,
    target: "outbound",
    exchangeId: null,
    sourceRevision: 3,
    parcelRevision: 2,
    parcelFingerprint: FINGERPRINT,
    providerWorkReference: "work_ref.1",
    requestedAt: CANCEL_REQUESTED_AT,
    ...overrides,
  } as NpShopPackingWorkCancelRequest;
}

function storedPackingWork(
  overrides: Partial<NpShopStoredPackingWork> = {},
): NpShopStoredPackingWork {
  return {
    contract: NP_SHOP_PACKING_WORK_STORAGE_CONTRACT,
    workId: WORK_ID,
    orderId: ORDER_ID,
    target: "outbound",
    exchangeId: null,
    providerId: "test-packing",
    status: "pending",
    revision: 1,
    sourceRevision: 3,
    parcelRevision: 2,
    parcelFingerprint: FINGERPRINT,
    lines,
    parcels,
    providerWorkReference: null,
    providerErrorCode: null,
    cancellationId: null,
    attachedShipmentId: null,
    requestedAt: REQUESTED_AT,
    confirmedAt: null,
    activatedAt: null,
    cancelRequestedAt: null,
    cancelledAt: null,
    consumedAt: null,
    updatedAt: UPDATED_AT,
    purgeAt: PURGE_AT,
    ...overrides,
  } as NpShopStoredPackingWork;
}

describe("Shop packing work contract", () => {
  it("accepts exact outbound and replacement create snapshots", () => {
    expect(npAnalyzeShopPackingWorkCreateRequest(createRequest())).toEqual([]);
    expect(
      npAnalyzeShopPackingWorkCreateRequest(
        createRequest({ target: "replacement", exchangeId: EXCHANGE_ID }),
      ),
    ).toEqual([]);
  });

  it("rejects target, revision, fingerprint, and exact-allocation mismatches", () => {
    expect(
      npAnalyzeShopPackingWorkCreateRequest(
        createRequest({ target: "replacement", exchangeId: null }),
      ).join(" "),
    ).toMatch(/exchange identity/u);
    expect(
      npAnalyzeShopPackingWorkCreateRequest(createRequest({ sourceRevision: 0 })).join(" "),
    ).toMatch(/sourceRevision/u);
    expect(
      npAnalyzeShopPackingWorkCreateRequest(
        createRequest({ parcelFingerprint: "A".repeat(64) }),
      ).join(" "),
    ).toMatch(/lowercase SHA-256/u);
    expect(
      npAnalyzeShopPackingWorkCreateRequest(
        createRequest({
          parcels: [
            {
              ...parcels[0],
              items: [{ lineKey: "line-1", quantity: 1 }],
            },
          ],
        }),
      ).join(" "),
    ).toMatch(/exact quantity/u);
  });

  it("rejects unknown keys, non-plain prototypes, and accessors without invoking them", () => {
    expect(
      npAnalyzeShopPackingWorkCreateRequest({ ...createRequest(), secret: "no" }).join(" "),
    ).toMatch(/secret is not supported/u);
    expect(
      npAnalyzeShopPackingWorkCreateRequest(
        Object.assign(Object.create({ inherited: true }) as object, createRequest()),
      ).join(" "),
    ).toMatch(/plain data object/u);

    let reads = 0;
    const accessorRequest = { ...createRequest() } as Record<string, unknown>;
    Object.defineProperty(accessorRequest, "orderId", {
      enumerable: true,
      get() {
        reads += 1;
        return ORDER_ID;
      },
    });
    expect(npAnalyzeShopPackingWorkCreateRequest(accessorRequest).join(" ")).toMatch(
      /enumerable data property/u,
    );
    expect(reads).toBe(0);

    const accessorLines = [...lines] as unknown[];
    Object.defineProperty(accessorLines, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return lines[0];
      },
    });
    expect(
      npAnalyzeShopPackingWorkCreateRequest(createRequest({ lines: accessorLines })).join(" "),
    ).toMatch(/enumerable data property/u);
    expect(reads).toBe(0);

    const revoked = Proxy.revocable(createRequest(), {});
    revoked.revoke();
    expect(() => npAnalyzeShopPackingWorkCreateRequest(revoked.proxy)).not.toThrow();
    expect(npAnalyzeShopPackingWorkCreateRequest(revoked.proxy).join(" ")).toMatch(
      /could not be inspected safely/u,
    );

    let statusCoercions = 0;
    const hostileStatus = {
      [Symbol.toPrimitive]() {
        statusCoercions += 1;
        throw new Error("must not execute");
      },
    };
    const hostileStored = storedPackingWork({ status: hostileStatus as never });
    expect(() => npAnalyzeStoredShopPackingWork(hostileStored)).not.toThrow();
    expect(npAnalyzeStoredShopPackingWork(hostileStored).join(" ")).toMatch(/status/u);
    expect(statusCoercions).toBe(0);
  });

  it("bounds oversized arrays and nested graphs before accepting provider data", () => {
    const oversizedLines = Array.from(
      { length: npShopPackingWorkLimits.maximumLines + 1 },
      () => lines[0],
    );
    expect(
      npAnalyzeShopPackingWorkCreateRequest(createRequest({ lines: oversizedLines })).join(" "),
    ).toMatch(/between 1 and 100 entries/u);

    const oversizedGraphParcels = Array.from(
      { length: npShopPackingWorkLimits.maximumParcels },
      (_, parcelIndex) => ({
        ...parcels[0],
        id: `box-${(parcelIndex + 1).toString()}`,
        items: Array.from(
          { length: npShopPackingWorkLimits.maximumAllocations },
          (_, itemIndex) => ({ lineKey: `line-${itemIndex.toString()}`, quantity: 1 }),
        ),
      }),
    );
    expect(() =>
      npAnalyzeShopPackingWorkCreateRequest(createRequest({ parcels: oversizedGraphParcels })),
    ).not.toThrow();
    expect(
      npAnalyzeShopPackingWorkCreateRequest(createRequest({ parcels: oversizedGraphParcels })).join(
        " ",
      ),
    ).toMatch(/graph limit|at most 100 allocations/u);
  });

  it("serializes one canonical PII-free fingerprint source", () => {
    const source = {
      target: "outbound",
      exchangeId: null,
      sourceRevision: 3,
      parcelRevision: 2,
      lines,
      parcels,
    } as const;
    expect(npAnalyzeShopPackingWorkFingerprintSource(source)).toEqual([]);
    expect(npSerializeShopPackingWorkFingerprintSource(source)).toBe(
      `{"target":"outbound","exchangeId":null,"sourceRevision":3,"parcelRevision":2,"lines":[{"lineKey":"line-1","productId":"${PRODUCT_ID}","productSlug":"sample-product","variantSku":"BLUE-L","quantity":2}],"parcels":[{"id":"box-1","lengthMm":300,"widthMm":200,"heightMm":100,"weightGrams":1500,"items":[{"lineKey":"line-1","quantity":2}]}]}`,
    );
    expect(npRequireShopPackingWorkParcelFingerprint(FINGERPRINT)).toBe(FINGERPRINT);
    expect(() => npRequireShopPackingWorkParcelFingerprint("bad")).toThrow(
      NpShopPackingWorkContractError,
    );
  });

  it("echoes every create identity field and applies bounded clock tolerance", () => {
    const request = createRequest();
    const result = npCreateShopPackingWorkCreateResult(request, {
      providerWorkReference: "work_ref.1",
      confirmedAt: CONFIRMED_AT,
    });
    expect(result.contract).toBe(NP_SHOP_PACKING_WORK_CREATE_RESULT_CONTRACT);
    expect(
      npAnalyzeShopPackingWorkCreateResultForRequest(
        request,
        result,
        new Date("2026-08-11T00:00:02.000Z"),
      ),
    ).toEqual([]);
    expect(
      npAnalyzeShopPackingWorkCreateResultForRequest(
        request,
        { ...result, parcelRevision: 4 },
        new Date("2026-08-11T00:00:02.000Z"),
      ).join(" "),
    ).toMatch(/result.parcelRevision must match/u);
    expect(
      npAnalyzeShopPackingWorkCreateResultForRequest(
        request,
        { ...result, confirmedAt: "2026-08-11T00:00:33.001Z" },
        new Date("2026-08-11T00:00:03.000Z"),
      ).join(" "),
    ).toMatch(/too far in the future/u);

    const resultWithThrowingReads = new Proxy(result, {
      get() {
        throw new Error("validator invoked a proxy read");
      },
    });
    expect(() =>
      npAnalyzeShopPackingWorkCreateResultForRequest(
        request,
        resultWithThrowingReads,
        new Date("2026-08-11T00:00:02.000Z"),
      ),
    ).not.toThrow();
    expect(() => npRequireShopPackingWorkCreateResult(resultWithThrowingReads)).not.toThrow();
    expect(npRequireShopPackingWorkCreateResult(resultWithThrowingReads)).toEqual(result);

    const fakeDate = Object.create(Date.prototype) as Date;
    expect(() =>
      npAnalyzeShopPackingWorkCreateResultForRequest(request, result, fakeDate),
    ).not.toThrow();
    expect(
      npAnalyzeShopPackingWorkCreateResultForRequest(request, result, fakeDate).join(" "),
    ).toMatch(/evaluatedAt is invalid/u);

    class OverriddenDate extends Date {
      override getTime(): number {
        throw new Error("validator invoked an overridden getTime");
      }
    }
    expect(
      npAnalyzeShopPackingWorkCreateResultForRequest(
        request,
        result,
        new OverriddenDate("2026-08-11T00:00:02.000Z"),
      ),
    ).toEqual([]);

    const proxiedDate = new Proxy(new Date("2026-08-11T00:00:02.000Z"), {});
    expect(() =>
      npAnalyzeShopPackingWorkCreateResultForRequest(request, result, proxiedDate),
    ).not.toThrow();
    expect(
      npAnalyzeShopPackingWorkCreateResultForRequest(request, result, proxiedDate).join(" "),
    ).toMatch(/evaluatedAt is invalid/u);
  });

  it("supports reference-free cancellation and exact cancellation echoes", () => {
    const request = cancelRequest({ providerWorkReference: null });
    expect(npAnalyzeShopPackingWorkCancelRequest(request)).toEqual([]);
    const result = npCreateShopPackingWorkCancelResult(request, { cancelledAt: CANCELLED_AT });
    expect(result.contract).toBe(NP_SHOP_PACKING_WORK_CANCEL_RESULT_CONTRACT);
    expect(result.providerWorkReference).toBeNull();
    expect(
      npAnalyzeShopPackingWorkCancelResultForRequest(
        request,
        result,
        new Date("2026-08-11T00:00:05.000Z"),
      ),
    ).toEqual([]);
    const resultWithThrowingReads = new Proxy(result, {
      get() {
        throw new Error("validator invoked a proxy read");
      },
    });
    expect(() => npRequireShopPackingWorkCancelResult(resultWithThrowingReads)).not.toThrow();
    expect(npRequireShopPackingWorkCancelResult(resultWithThrowingReads)).toEqual(result);
    expect(
      npAnalyzeShopPackingWorkCancelResultForRequest(
        request,
        { ...result, cancellationId: WORK_ID },
        new Date("2026-08-11T00:00:05.000Z"),
      ).join(" "),
    ).toMatch(/result.cancellationId must match/u);
  });

  it.each([
    ["pending", {}],
    ["provider-confirmed", { providerWorkReference: "work_ref.1", confirmedAt: CONFIRMED_AT }],
    [
      "active",
      {
        providerWorkReference: "work_ref.1",
        confirmedAt: CONFIRMED_AT,
        activatedAt: ACTIVATED_AT,
      },
    ],
    ["cancel-pending", { cancellationId: CANCELLATION_ID, cancelRequestedAt: CANCEL_REQUESTED_AT }],
    [
      "cancel-confirmed",
      {
        cancellationId: CANCELLATION_ID,
        cancelRequestedAt: CANCEL_REQUESTED_AT,
        cancelledAt: CANCELLED_AT,
      },
    ],
    [
      "cancelled",
      {
        cancellationId: CANCELLATION_ID,
        cancelRequestedAt: CANCEL_REQUESTED_AT,
        cancelledAt: CANCELLED_AT,
      },
    ],
    [
      "consumed",
      {
        providerWorkReference: "work_ref.1",
        confirmedAt: CONFIRMED_AT,
        activatedAt: ACTIVATED_AT,
        attachedShipmentId: SHIPMENT_ID,
        consumedAt: CANCEL_REQUESTED_AT,
      },
    ],
    ["manual-review", { providerErrorCode: "provider-timeout" }],
  ] satisfies ReadonlyArray<
    readonly [NpShopStoredPackingWork["status"], Partial<NpShopStoredPackingWork>]
  >)("accepts the %s durable state", (status, fields) => {
    expect(npAnalyzeStoredShopPackingWork(storedPackingWork({ status, ...fields }))).toEqual([]);
  });

  it.each([
    [
      "active",
      {
        providerWorkReference: "work_ref.1",
        confirmedAt: CONFIRMED_AT,
        activatedAt: ACTIVATED_AT,
        attachedShipmentId: SHIPMENT_ID,
      },
    ],
    [
      "cancel-pending",
      {
        providerWorkReference: "work_ref.1",
        confirmedAt: CONFIRMED_AT,
        activatedAt: ACTIVATED_AT,
        attachedShipmentId: SHIPMENT_ID,
        cancellationId: CANCELLATION_ID,
        cancelRequestedAt: CANCEL_REQUESTED_AT,
      },
    ],
    [
      "cancel-confirmed",
      {
        providerWorkReference: "work_ref.1",
        confirmedAt: CONFIRMED_AT,
        activatedAt: ACTIVATED_AT,
        attachedShipmentId: SHIPMENT_ID,
        cancellationId: CANCELLATION_ID,
        cancelRequestedAt: CANCEL_REQUESTED_AT,
        cancelledAt: CANCELLED_AT,
      },
    ],
    [
      "cancelled",
      {
        providerWorkReference: "work_ref.1",
        confirmedAt: CONFIRMED_AT,
        activatedAt: ACTIVATED_AT,
        attachedShipmentId: SHIPMENT_ID,
        cancellationId: CANCELLATION_ID,
        cancelRequestedAt: CANCEL_REQUESTED_AT,
        cancelledAt: CANCELLED_AT,
      },
    ],
    [
      "manual-review",
      {
        providerWorkReference: "work_ref.1",
        providerErrorCode: "provider-timeout",
        confirmedAt: CONFIRMED_AT,
        activatedAt: ACTIVATED_AT,
        attachedShipmentId: SHIPMENT_ID,
      },
    ],
    [
      "manual-review",
      {
        providerWorkReference: "work_ref.1",
        providerErrorCode: "provider-result-mismatch",
        confirmedAt: CONFIRMED_AT,
        activatedAt: ACTIVATED_AT,
        consumedAt: CANCEL_REQUESTED_AT,
      },
    ],
  ] satisfies ReadonlyArray<
    readonly [NpShopStoredPackingWork["status"], Partial<NpShopStoredPackingWork>]
  >)("preserves the carrier cross-link in %s", (status, fields) => {
    expect(npAnalyzeStoredShopPackingWork(storedPackingWork({ status, ...fields }))).toEqual([]);
  });

  it.each([
    ["pending", { attachedShipmentId: SHIPMENT_ID }],
    [
      "provider-confirmed",
      {
        providerWorkReference: "work_ref.1",
        confirmedAt: CONFIRMED_AT,
        attachedShipmentId: SHIPMENT_ID,
      },
    ],
  ] satisfies ReadonlyArray<
    readonly [NpShopStoredPackingWork["status"], Partial<NpShopStoredPackingWork>]
  >)("rejects a carrier cross-link in %s", (status, fields) => {
    expect(
      npAnalyzeStoredShopPackingWork(storedPackingWork({ status, ...fields })).join(" "),
    ).toMatch(/attachedShipmentId/u);
  });

  it("accepts both manual and carrier-linked consumption", () => {
    const consumedBase = {
      status: "consumed" as const,
      providerWorkReference: "work_ref.1",
      confirmedAt: CONFIRMED_AT,
      activatedAt: ACTIVATED_AT,
      consumedAt: CANCEL_REQUESTED_AT,
    };
    expect(
      npAnalyzeStoredShopPackingWork(
        storedPackingWork({ ...consumedBase, attachedShipmentId: null }),
      ),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopPackingWork(
        storedPackingWork({ ...consumedBase, attachedShipmentId: SHIPMENT_ID }),
      ),
    ).toEqual([]);
  });

  it("keeps overdue external effects valid for cancellation and reconciliation", () => {
    expect(
      npAnalyzeStoredShopPackingWork(
        storedPackingWork({
          status: "cancel-pending",
          cancellationId: CANCELLATION_ID,
          cancelRequestedAt: "2028-01-01T00:00:01.000Z",
          updatedAt: "2028-01-01T00:00:01.000Z",
        }),
      ),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopPackingWork(storedPackingWork({ purgeAt: REQUESTED_AT })).join(" "),
    ).toMatch(/purgeAt must follow the original request/u);
  });

  it("rejects partial state tuples and unsafe terminal combinations", () => {
    expect(
      npAnalyzeStoredShopPackingWork(
        storedPackingWork({ status: "active", providerWorkReference: "work_ref.1" }),
      ).join(" "),
    ).toMatch(/provider confirmation fields|active fields/u);
    expect(
      npAnalyzeStoredShopPackingWork(
        storedPackingWork({ status: "manual-review", providerErrorCode: null }),
      ).join(" "),
    ).toMatch(/requires one closed provider error/u);
    expect(
      npAnalyzeStoredShopPackingWork(
        storedPackingWork({
          status: "cancelled",
          cancellationId: CANCELLATION_ID,
          cancelRequestedAt: CANCEL_REQUESTED_AT,
          cancelledAt: CANCELLED_AT,
          attachedShipmentId: SHIPMENT_ID,
          consumedAt: UPDATED_AT,
        }),
      ).join(" "),
    ).toMatch(/allowed only in consumed|cannot be attached/u);
  });

  it("parses exact create and existing Admin row envelopes", () => {
    expect(
      npRequireShopFulfillmentPackingWorkCreateInput({
        row: {
          id: ORDER_ID,
          fulfillmentRevision: 3,
          parcelRevision: 2,
          packingWorkRevision: null,
        },
        values: {},
      }),
    ).toEqual({
      orderId: ORDER_ID,
      target: "outbound",
      exchangeId: null,
      expectedSourceRevision: 3,
      expectedParcelRevision: 2,
      expectedWorkRevision: null,
    });
    expect(
      npRequireShopExchangePackingWorkCreateInput({
        row: {
          id: ORDER_ID,
          exchangeId: EXCHANGE_ID,
          exchangeRevision: 5,
          parcelRevision: 4,
          packingWorkRevision: 2,
        },
        values: {},
      }),
    ).toEqual({
      orderId: ORDER_ID,
      target: "replacement",
      exchangeId: EXCHANGE_ID,
      expectedSourceRevision: 5,
      expectedParcelRevision: 4,
      expectedWorkRevision: 2,
    });
    expect(
      npRequireShopPackingWorkExistingActionInput({
        row: {
          id: ORDER_ID,
          packingWorkTarget: "replacement",
          exchangeId: EXCHANGE_ID,
          packingWorkId: WORK_ID,
          packingWorkRevision: 3,
        },
        values: {},
      }),
    ).toEqual({
      orderId: ORDER_ID,
      target: "replacement",
      exchangeId: EXCHANGE_ID,
      workId: WORK_ID,
      expectedRevision: 3,
    });
    expect(() =>
      npRequireShopPackingWorkExistingActionInput({
        row: {
          id: ORDER_ID,
          packingWorkTarget: "outbound",
          exchangeId: null,
          packingWorkId: WORK_ID,
          packingWorkRevision: 3,
          unsafe: true,
        },
        values: {},
      }),
    ).toThrow(NpShopPackingWorkContractError);
  });

  it("uses target-specific canonical storage keys and canonical provider ids", () => {
    expect(npShopPackingWorkStorageKey("outbound", ORDER_ID)).toBe(
      `packing-work:outbound:${ORDER_ID}`,
    );
    expect(npShopPackingWorkStorageKey("replacement", ORDER_ID)).toBe(
      `packing-work:replacement:${ORDER_ID}`,
    );
    expect(npRequireShopPackingWorkProviderId("warehouse-one")).toBe("warehouse-one");
    expect(() => npRequireShopPackingWorkProviderId("Warehouse One")).toThrow(
      NpShopPackingWorkContractError,
    );
    const requireStorageKey = npShopPackingWorkStorageKey as (
      target: unknown,
      orderId: unknown,
    ) => string;
    let coercions = 0;
    const hostileOrderId = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        throw new Error("must not execute");
      },
    };
    expect(() => requireStorageKey("outbound", Symbol("order"))).toThrow(
      NpShopPackingWorkContractError,
    );
    expect(() => requireStorageKey("outbound", hostileOrderId)).toThrow(
      NpShopPackingWorkContractError,
    );
    expect(coercions).toBe(0);
  });

  it("types paired adapter methods and makes cancellation dominate delayed creates", async () => {
    const cancelledWorkIds = new Set<string>();
    const adapter: NpShopPackingWorkAdapter = {
      id: "test-packing",
      async createPackingWork(request) {
        await Promise.resolve();
        if (cancelledWorkIds.has(request.workId)) throw new NpShopPackingWorkUnavailableError();
        return npCreateShopPackingWorkCreateResult(request, {
          providerWorkReference: "work_ref.1",
          confirmedAt: CONFIRMED_AT,
        });
      },
      async cancelPackingWork(request) {
        await Promise.resolve();
        cancelledWorkIds.add(request.workId);
        return npCreateShopPackingWorkCancelResult(request, { cancelledAt: CANCELLED_AT });
      },
    };

    await expect(
      adapter.cancelPackingWork(cancelRequest({ providerWorkReference: null })),
    ).resolves.toMatchObject({ cancellationId: CANCELLATION_ID });
    await expect(adapter.createPackingWork(createRequest())).rejects.toThrow(
      NpShopPackingWorkUnavailableError,
    );
    expect(new NpShopPackingWorkUnavailableError().message).toBe(
      "Packing work provider is temporarily unavailable.",
    );
  });

  it("rejects invalid or hostile provider-error constructor inputs", () => {
    expect(
      new NpShopPackingWorkProviderError("warehouse-rejected", "closed provider result", {
        retryable: false,
      }),
    ).toMatchObject({ code: "warehouse-rejected", retryable: false });
    expect(
      () =>
        new NpShopPackingWorkProviderError("Warehouse_Rejected", "closed provider result", {
          retryable: false,
        }),
    ).toThrow(NpShopPackingWorkContractError);

    let accessorReads = 0;
    const accessorOptions = Object.defineProperty({}, "retryable", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return false;
      },
    });
    expect(
      () =>
        new NpShopPackingWorkProviderError(
          "warehouse-rejected",
          "closed provider result",
          accessorOptions as { retryable: boolean },
        ),
    ).toThrow(NpShopPackingWorkContractError);
    expect(accessorReads).toBe(0);

    const hostileOptions = new Proxy(
      { retryable: false },
      {
        getOwnPropertyDescriptor() {
          throw new Error("must not escape");
        },
      },
    );
    expect(
      () =>
        new NpShopPackingWorkProviderError(
          "warehouse-rejected",
          "closed provider result",
          hostileOptions,
        ),
    ).toThrow(NpShopPackingWorkContractError);
  });

  it("keeps the durable status vocabulary closed", () => {
    expect(npShopPackingWorkStatuses).toEqual([
      "pending",
      "provider-confirmed",
      "active",
      "cancel-pending",
      "cancel-confirmed",
      "cancelled",
      "consumed",
      "manual-review",
    ]);
  });
});
