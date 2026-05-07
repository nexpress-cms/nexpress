"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

interface SubscribeFormProps {
  endpoint: string;
  listId: string;
  buttonText: string;
  successMessage: string;
  placeholder: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const wrapperStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
};

const inputStyle: CSSProperties = {
  flex: 1,
  padding: "0.625rem 0.875rem",
  borderRadius: "0.5rem",
  border: "1px solid #cbd5e1",
  fontSize: "0.95rem",
};

const buttonStyle: CSSProperties = {
  padding: "0.625rem 1.125rem",
  borderRadius: "0.5rem",
  border: "none",
  backgroundColor: "#0f172a",
  color: "#f8fafc",
  fontWeight: 600,
  cursor: "pointer",
};

const buttonDisabledStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: "#475569",
  cursor: "not-allowed",
};

export function SubscribeForm({
  endpoint,
  listId,
  buttonText,
  successMessage,
  placeholder,
}: SubscribeFormProps): React.ReactElement {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status.kind === "submitting") return;
    setStatus({ kind: "submitting" });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, listId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; error?: string }
        | null;
      if (!response.ok || payload?.ok === false) {
        setStatus({
          kind: "error",
          message: payload?.error ?? `Subscribe failed (${response.status})`,
        });
        return;
      }
      setStatus({
        kind: "success",
        message: payload?.message ?? successMessage,
      });
      setEmail("");
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Subscribe failed",
      });
    }
  };

  if (status.kind === "success") {
    return (
      <p
        style={{
          padding: "0.875rem 1rem",
          borderRadius: "0.5rem",
          backgroundColor: "#dcfce7",
          color: "#166534",
          margin: 0,
        }}
      >
        {status.message}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        // The handler is async; React's `onSubmit` type expects a
        // void return, so wrap with `void` to satisfy
        // `@typescript-eslint/no-misused-promises`.
        void onSubmit(event);
      }}
      style={wrapperStyle}
    >
      <div style={rowStyle}>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          placeholder={placeholder}
          style={inputStyle}
          aria-label="Email address"
          disabled={status.kind === "submitting"}
        />
        <button
          type="submit"
          style={status.kind === "submitting" ? buttonDisabledStyle : buttonStyle}
          disabled={status.kind === "submitting"}
        >
          {status.kind === "submitting" ? "…" : buttonText}
        </button>
      </div>
      {status.kind === "error" ? (
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
