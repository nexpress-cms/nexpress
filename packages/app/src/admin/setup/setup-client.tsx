"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AuthCard,
  AuthLayout,
  Button,
  Input,
  Label,
  Switch,
} from "@nexpress/admin/client";

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

export interface SetupWizardProps {
  /**
   * Server-side env (`NP_ADMIN_EMAIL`, `NP_ADMIN_NAME`) read by the
   * page component and forwarded so an automated boot doesn't make
   * the operator retype values they've already configured. Password
   * is intentionally absent — it never reaches the browser.
   */
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
          error?: {
            message?: string;
            fields?: Array<{ field: string; message: string }>;
          };
        };
        // NpValidationError carries the actual offending fields in
        // `fields[]`; surfacing only the umbrella `message` ("Invalid
        // input") leaves operators staring at a screen that says
        // nothing about what's wrong with their input.
        const fieldDetail = body.error?.fields
          ?.map((f) => `${f.field}: ${f.message}`)
          .join(" — ");
        setError(
          fieldDetail
            ? `${body.error?.message ?? "Setup failed"} (${fieldDetail})`
            : body.error?.message ?? "Setup failed.",
        );
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
    <AuthLayout>
      <AuthCard
        title="Welcome to NexPress"
        description={
          <span>
            Step <strong className="font-semibold text-neutral-700 dark:text-neutral-200">{step}</strong>{" "}
            of 2 — {step === 1 ? "create your admin" : "site basics"}
          </span>
        }
        className="max-w-[420px]"
      >
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {step === 1 && (
          <form onSubmit={handleNext} className="flex flex-col gap-3">
            <FieldRow id="email" label="Email" required>
              <Input
                id="email"
                type="email"
                value={account.email}
                onChange={(e) => setAccount({ ...account, email: e.target.value })}
                autoComplete="email"
                required
                placeholder="admin@example.com"
              />
            </FieldRow>
            <FieldRow id="name" label="Name (optional)">
              <Input
                id="name"
                value={account.name}
                onChange={(e) => setAccount({ ...account, name: e.target.value })}
                autoComplete="name"
                placeholder="Site Admin"
              />
            </FieldRow>
            <FieldRow
              id="password"
              label={`Password (min ${PASSWORD_MIN} characters)`}
              required
            >
              <Input
                id="password"
                type="password"
                value={account.password}
                onChange={(e) => setAccount({ ...account, password: e.target.value })}
                autoComplete="new-password"
                required
              />
            </FieldRow>
            <FieldRow id="password-confirm" label="Confirm password" required>
              <Input
                id="password-confirm"
                type="password"
                value={account.passwordConfirm}
                onChange={(e) =>
                  setAccount({ ...account, passwordConfirm: e.target.value })
                }
                autoComplete="new-password"
                required
              />
            </FieldRow>
            <Button type="submit" className="mt-1 h-9 w-full justify-center">
              Continue
            </Button>
          </form>
        )}

        {step === 2 && (
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="flex flex-col gap-3"
          >
            <FieldRow id="site-name" label="Site name">
              <Input
                id="site-name"
                value={site.siteName}
                onChange={(e) => setSite({ ...site, siteName: e.target.value })}
                placeholder="My Site"
              />
            </FieldRow>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200/80 bg-neutral-50/60 px-3 py-2.5 dark:border-neutral-800/80 dark:bg-neutral-900/40">
              <div className="flex-1">
                <div className="text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">
                  Add sample content
                </div>
                <p className="mt-0.5 text-[11.5px] leading-[1.5] text-neutral-500 dark:text-neutral-400">
                  Three pages, three posts, and a starter navigation menu so the public
                  site renders something out of the box. You can delete or edit them later.
                </p>
              </div>
              <Switch
                checked={site.sampleContent}
                onCheckedChange={(checked) =>
                  setSite({ ...site, sampleContent: checked })
                }
                aria-label="Add sample content"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                className="flex-1 justify-center"
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 justify-center"
              >
                {submitting ? "Setting up…" : "Finish"}
              </Button>
            </div>
          </form>
        )}
      </AuthCard>
    </AuthLayout>
  );
}

interface FieldRowProps {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}

function FieldRow({ id, label, required, children }: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[12.5px]">
        {label}
        {required ? <span aria-hidden className="ml-0.5 text-red-500">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
