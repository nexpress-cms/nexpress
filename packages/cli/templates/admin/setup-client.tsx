"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2;

interface AccountState {
  email: string;
  password: string;
  passwordConfirm: string;
  name: string;
}

interface SiteState {
  siteName: string;
}

const PASSWORD_MIN = 12;

export interface SetupWizardProps {
  prefill?: {
    email?: string;
    name?: string;
  };
}

export function SetupWizard({ prefill }: SetupWizardProps = {}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [account, setAccount] = useState<AccountState>({
    email: prefill?.email ?? "",
    password: "",
    passwordConfirm: "",
    name: prefill?.name ?? "",
  });
  const [site, setSite] = useState<SiteState>({ siteName: "My Site" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function validateAccount(): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email)) {
      return "Enter a valid email address.";
    }
    if (account.password.length < PASSWORD_MIN) {
      return `Password must be at least ${PASSWORD_MIN} characters.`;
    }
    if (account.password !== account.passwordConfirm) {
      return "Passwords do not match.";
    }
    return null;
  }

  function handleNext(e: FormEvent) {
    e.preventDefault();
    setError("");
    const issue = validateAccount();
    if (issue) {
      setError(issue);
      return;
    }
    setStep(2);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
          ...(account.name.trim() ? { name: account.name.trim() } : {}),
          ...(site.siteName.trim() ? { siteName: site.siteName.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(body.error?.message ?? "Setup failed.");
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold">Welcome to NexPress</h1>
        <p className="mt-1 text-sm text-slate-500">
          Step {step} of 2 — {step === 1 ? "create your admin" : "site basics"}
        </p>
      </header>

      {error ? (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {step === 1 ? (
        <form onSubmit={handleNext} className="space-y-4">
          <Field
            id="email"
            label="Email"
            type="email"
            value={account.email}
            onChange={(v) => setAccount({ ...account, email: v })}
            autoComplete="email"
            required
            placeholder="admin@example.com"
          />
          <Field
            id="name"
            label="Name (optional)"
            value={account.name}
            onChange={(v) => setAccount({ ...account, name: v })}
            autoComplete="name"
            placeholder="Site Admin"
          />
          <Field
            id="password"
            label={`Password (min ${PASSWORD_MIN.toString()} characters)`}
            type="password"
            value={account.password}
            onChange={(v) => setAccount({ ...account, password: v })}
            autoComplete="new-password"
            required
          />
          <Field
            id="password-confirm"
            label="Confirm password"
            type="password"
            value={account.passwordConfirm}
            onChange={(v) => setAccount({ ...account, passwordConfirm: v })}
            autoComplete="new-password"
            required
          />
          <button
            type="submit"
            className="w-full rounded bg-black px-4 py-2 text-white"
          >
            Continue
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          <Field
            id="site-name"
            label="Site name"
            value={site.siteName}
            onChange={(v) => setSite({ siteName: v })}
            placeholder="My Site"
          />
          <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            Need sample pages and posts to start with? Run{" "}
            <code>pnpm seed:content</code> after finishing this wizard.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 rounded border px-4 py-2 text-sm"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {submitting ? "Setting up…" : "Finish"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  autoComplete,
}: FieldProps) {
  return (
    <label htmlFor={id} className="block space-y-1 text-sm">
      <span>{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="block w-full rounded border px-3 py-2"
      />
    </label>
  );
}
