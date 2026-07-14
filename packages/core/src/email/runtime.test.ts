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
  });

  it("rejects widened runtime config objects", () => {
    expect(() => configureEmailRuntime({ adapter: "noop", options: {} } as never)).toThrow(
      /email\.runtime\.options/u,
    );
  });
});
