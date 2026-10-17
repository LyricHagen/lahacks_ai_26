"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { login, signup } from "@/app/login/actions";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";

const log = createLogger("auth.form");

export function AuthForm({ kind, next }: { kind: "login" | "signup"; next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string; reqId: string | null } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    log.info(`${kind} submitted`, { hasNext: !!next });
    try {
      const r = kind === "login" ? await runAction("auth.login", login, { email, password, next }) : await runAction("auth.signup", signup, { email, password });
      log.info(`${kind} ok, navigating to ${r.to}`, { status: r.status });
      router.push(r.to);
      router.refresh();
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      log.warn(`${kind} failed`, { code: ae?.code ?? "UNKNOWN" });
      setError({ code: ae?.code ?? "UNKNOWN", message: ae?.message ?? String(err), reqId: ae?.reqId ?? null });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={!!error || undefined} />
      </Field>
      <Field label="Password" htmlFor="password" hint={kind === "signup" ? "At least 8 characters." : undefined}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={kind === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={kind === "signup" ? 8 : undefined}
          aria-invalid={!!error || undefined}
        />
      </Field>
      {error ? (
        <div role="alert" className="border border-danger bg-danger-soft px-3 py-2 text-sm">
          <p className="font-semibold text-danger">Error: {error.message}</p>
          <p className="mt-1 font-mono text-[12px] text-muted">
            code <span className="text-fg">{error.code}</span>
            {error.reqId ? (
              <>
                {"  "}request <span className="text-fg">{error.reqId}</span>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" disabled={busy || !email || !password}>
          {busy ? (kind === "login" ? "Logging in..." : "Creating account...") : kind === "login" ? "Log in" : "Create account"}
        </Button>
        {kind === "login" ? (
          <span className="text-sm text-muted">
            No account? <Link href="/signup">Sign up</Link>
          </span>
        ) : (
          <span className="text-sm text-muted">
            Have an account? <Link href="/login">Log in</Link>
          </span>
        )}
      </div>
    </form>
  );
}
