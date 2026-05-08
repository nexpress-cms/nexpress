import { useCallback, useEffect, useState } from "react";

import type { NpAuthErrorCode } from "../../shared/types.js";
import { resolveMessages, submitJson } from "../internal/submit.js";

export interface UseMemberVerifyEmailOptions {
  /**
   * Verification token from the email link. Pages typically read
   * this from `searchParams.token` and pass it in.
   */
  token: string;
  endpoint?: string;
  messages?: Partial<Record<NpAuthErrorCode, string>>;
  /**
   * Verify automatically on mount. Default `true` — the page
   * mostly exists to consume the token and bounce. Set `false`
   * if you want the user to click a confirm button first.
   */
  autoVerify?: boolean;
  onSuccess?: (payload: { memberId: string; handle: string; email: string }) => void;
  onError?: (err: { code: NpAuthErrorCode; message: string }) => void;
}

export interface UseMemberVerifyEmailResult {
  status: "idle" | "verifying" | "success" | "error";
  error: string | null;
  /** Manual trigger — only matters when `autoVerify: false`. */
  verify: () => Promise<void>;
}

export function useMemberVerifyEmail(
  options: UseMemberVerifyEmailOptions,
): UseMemberVerifyEmailResult {
  const endpoint = options.endpoint ?? "/api/members/verify";
  const autoVerify = options.autoVerify !== false;
  const messages = resolveMessages(options.messages);
  const [status, setStatus] = useState<UseMemberVerifyEmailResult["status"]>("idle");
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    if (!options.token) {
      setStatus("error");
      setError(messages.TOKEN_INVALID);
      return;
    }
    setStatus("verifying");
    setError(null);
    const result = await submitJson<{ memberId: string; handle: string; email: string }>(
      endpoint,
      { token: options.token },
      messages,
    );
    if (!result.ok) {
      setStatus("error");
      setError(result.message);
      options.onError?.({ code: result.code, message: result.message });
      return;
    }
    setStatus("success");
    options.onSuccess?.(result.data);
  }, [endpoint, messages, options]);

  useEffect(() => {
    if (autoVerify) void verify();
    // We intentionally fire once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, error, verify };
}
