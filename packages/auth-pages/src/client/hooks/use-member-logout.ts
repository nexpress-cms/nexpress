import { useCallback, useState } from "react";

import type { NpAuthErrorCode } from "../../shared/types.js";
import { resolveMessages, submitJson } from "../internal/submit.js";

export interface UseMemberLogoutOptions {
  endpoint?: string;
  messages?: Partial<Record<NpAuthErrorCode, string>>;
  onSuccess?: () => void;
  onError?: (err: { code: NpAuthErrorCode; message: string }) => void;
}

export interface UseMemberLogoutResult {
  isSubmitting: boolean;
  error: string | null;
  /**
   * Trigger logout. No form needed — pages call this from a
   * button onClick or a useEffect on a dedicated `/logout` page.
   */
  logout: () => Promise<void>;
}

export function useMemberLogout(
  options: UseMemberLogoutOptions = {},
): UseMemberLogoutResult {
  const endpoint = options.endpoint ?? "/api/members/logout";
  const messages = resolveMessages(options.messages);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await submitJson<{ ok: true }>(endpoint, {}, messages);
      if (!result.ok) {
        setError(result.message);
        options.onError?.({ code: result.code, message: result.message });
        return;
      }
      options.onSuccess?.();
    } finally {
      setIsSubmitting(false);
    }
  }, [endpoint, isSubmitting, messages, options]);

  return { isSubmitting, error, logout };
}
