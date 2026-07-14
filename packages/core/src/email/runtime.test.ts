import { afterEach, describe, expect, it } from "vitest";

import { getEmailAdapter, resetEmailAdapter, setEmailAdapter } from "./service.js";
import { configureEmailRuntime, configureEmailRuntimeFromEnv } from "./runtime.js";
import { SmtpEmailAdapter } from "./smtp.js";

afterEach(() => {
  resetEmailAdapter();
});

describe("email runtime installation", () => {
  it("installs validated SMTP and noop modes", () => {
    configureEmailRuntimeFromEnv({
      NP_EMAIL_ADAPTER: "smtp",
      NP_SMTP_HOST: "smtp.example.com",
      NP_SMTP_FROM: "noreply@example.com",
    });
    expect(getEmailAdapter()).toBeInstanceOf(SmtpEmailAdapter);

    configureEmailRuntime({ adapter: "noop" });
    expect(getEmailAdapter().kind).toBe("noop");
  });

  it("requires and preserves a programmatic adapter in custom mode", () => {
    expect(() => configureEmailRuntime({ adapter: "custom" })).toThrow(/setEmailAdapter/u);

    const custom = { kind: "resend", send: () => Promise.resolve(undefined) };
    setEmailAdapter(custom);
    configureEmailRuntime({ adapter: "custom" });
    expect(getEmailAdapter()).toBe(custom);

    const injected = { kind: "postmark", send: () => Promise.resolve(undefined) };
    configureEmailRuntime({ adapter: "custom" }, injected);
    expect(getEmailAdapter()).toBe(injected);
    expect(() => configureEmailRuntime({ adapter: "noop" }, injected)).toThrow(
      /only be injected when adapter is custom/u,
    );
    expect(() => configureEmailRuntime({ adapter: "custom" }, { kind: "broken" } as never)).toThrow(
      /email\.adapter\.send/u,
    );
  });

  it("rejects widened runtime config objects", () => {
    expect(() => configureEmailRuntime({ adapter: "noop", options: {} } as never)).toThrow(
      /email\.runtime\.options/u,
    );
  });
});
