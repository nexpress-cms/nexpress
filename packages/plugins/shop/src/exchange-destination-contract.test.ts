import { describe, expect, it } from "vitest";

import {
  NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT,
  NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT,
  npAnalyzeShopExchangeDestinationAuthority,
  npAnalyzeStoredShopExchangeDestinationPrivate,
  npRequireShopExchangeDestinationReadInput,
  npRequireShopExchangeDestinationSubmitInput,
} from "./exchange-destination-contract.js";

const destination = {
  recipientName: "홍길동",
  phone: "+82 10-1234-5678",
  countryCode: "KR",
  postalCode: "04524",
  addressLine1: "서울특별시 중구 세종대로 110",
  addressLine2: "10층",
  locality: "중구",
  administrativeArea: "서울특별시",
};

describe("Shop exchange destination contract", () => {
  it("accepts exact short-lived private state and rejects PII shape drift", () => {
    const stored = {
      contract: NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT,
      orderId: "123e4567-e89b-42d3-a456-426614174000",
      exchangeId: "223e4567-e89b-42d3-a456-426614174000",
      ownerSegment: `guest:${"a".repeat(64)}`,
      exchangeRevision: 2,
      destinationRevision: 1,
      destination,
      submittedAt: "2026-08-10T00:00:00.000Z",
      accessedAt: null,
      updatedAt: "2026-08-10T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:00.000Z",
    };
    expect(npAnalyzeStoredShopExchangeDestinationPrivate(stored)).toEqual([]);
    expect(
      npAnalyzeStoredShopExchangeDestinationPrivate({
        ...stored,
        destination: { ...destination, instructions: "leave outside" },
      }),
    ).toContain("exchange destination.destination.instructions is not supported.");
  });

  it("accepts only 15-minute revision-bound authorities", () => {
    const authority = {
      contract: NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT,
      orderId: "123e4567-e89b-42d3-a456-426614174000",
      exchangeId: "223e4567-e89b-42d3-a456-426614174000",
      orderRevision: 4,
      exchangeRevision: 1,
      destinationRevision: 0,
      token: "payload.signature",
      issuedAt: "2026-08-10T00:00:00.000Z",
      expiresAt: "2026-08-10T00:15:00.000Z",
    };
    expect(npAnalyzeShopExchangeDestinationAuthority(authority)).toEqual([]);
    expect(
      npAnalyzeShopExchangeDestinationAuthority({
        ...authority,
        expiresAt: "2026-08-10T00:15:00.001Z",
      }),
    ).toContain("exchange destination authority exceeds its 15-minute lifetime.");
  });

  it("normalizes owner input and validates the PII-free Admin row", () => {
    expect(
      npRequireShopExchangeDestinationSubmitInput({
        orderId: "123e4567-e89b-42d3-a456-426614174000",
        exchangeId: "223e4567-e89b-42d3-a456-426614174000",
        orderRevision: 4,
        exchangeRevision: 1,
        destinationRevision: 0,
        authorityToken: "payload.signature",
        destination: { ...destination, recipientName: "  홍길동  ", addressLine2: "" },
      }),
    ).toMatchObject({ destination: { recipientName: "홍길동", addressLine2: null } });
    expect(
      npRequireShopExchangeDestinationReadInput({
        row: {
          id: "123e4567-e89b-42d3-a456-426614174000",
          exchangeId: "223e4567-e89b-42d3-a456-426614174000",
          orderRevision: 4,
          exchangeRevision: 2,
          destinationRevision: 1,
        },
        values: {},
      }),
    ).toMatchObject({ destinationRevision: 1 });
  });
});
