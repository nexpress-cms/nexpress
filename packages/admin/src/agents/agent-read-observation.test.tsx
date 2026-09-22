import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentReadObservation } from "./agent-read-observation.js";

const generatedAt = "2026-09-20T00:00:00.000Z";

describe("Studio read observation boundaries", () => {
  it("does not manufacture receipt or projection evidence from invalid optional metadata", () => {
    for (const receivedAt of [undefined, NaN, Infinity, 1e20]) {
      expect(
        renderToStaticMarkup(
          <AgentReadObservation receivedAt={receivedAt} generatedAt={generatedAt} />,
        ),
      ).toBe("");
    }
    for (const value of [undefined, "provider-private-text", "2026-02-30T00:00:00.000Z"]) {
      const html = renderToStaticMarkup(
        <AgentReadObservation receivedAt={0} generatedAt={value} />,
      );
      expect(html).toContain("1970-01-01T00:00:00.000Z");
      expect(html).toContain("Server projection time unavailable.");
      expect(html).not.toContain("provider-private-text");
      expect(html).not.toContain("2026-02-30");
    }
  });
  it("preserves independently sourced clocks without deriving a freshness verdict", () => {
    // Client clock skew must not invalidate real server evidence or imply freshness.
    const html = renderToStaticMarkup(
      <AgentReadObservation
        receivedAt={0}
        generatedAt={generatedAt}
        refreshing
        label="Runtime status"
      />,
    );
    expect(html).toContain(`dateTime="${generatedAt}"`);
    expect(html).toContain('dateTime="1970-01-01T00:00:00.000Z"');
    expect(html).toContain("Previously received data");
    expect(html).toContain("do not establish underlying data freshness");
    expect(html).not.toContain('role="status"'); // Clock display must not duplicate the shared live refresh announcement.
  });
});
