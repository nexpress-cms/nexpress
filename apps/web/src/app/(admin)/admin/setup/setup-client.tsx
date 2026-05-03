"use client";

import { useState } from "react";
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
  sampleContent: boolean;
}

const PASSWORD_MIN = 12;

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [account, setAccount] = useState<AccountState>({
    email: "",
    password: "",
    passwordConfirm: "",
    name: "",
  });
  const [site, setSite] = useState<SiteState>({
    siteName: "My Site",
    sampleContent: true,
  });
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

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const issue = validateAccount();
    if (issue) {
      setError(issue);
      return;
    }
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
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
          sampleContent: site.sampleContent,
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
    <div className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-md">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold">Welcome to NexPress</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Step {step} of 2 — {step === 1 ? "create your admin" : "site basics"}
          </p>
        </header>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === 1 && (
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
              label={`Password (min ${PASSWORD_MIN} characters)`}
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
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Continue
            </button>
          </form>
        )}

        {step === 2 && (
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
              onChange={(v) => setSite({ ...site, siteName: v })}
              placeholder="My Site"
            />
            <label className="flex items-start gap-3 rounded-md border border-input bg-background p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={site.sampleContent}
                onChange={(e) =>
                  setSite({ ...site, sampleContent: e.target.checked })
                }
              />
              <span>
                <span className="block font-medium">Add sample content</span>
                <span className="block text-muted-foreground">
                  Three pages, three posts, and a starter navigation menu so
                  the public site renders something out of the box. You can
                  delete or edit them later.
                </span>
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Setting up…" : "Finish"}
              </button>
            </div>
          </form>
        )}
      </div>
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
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
