"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiFetch, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import type { PhoneView } from "@/lib/phone";
import { linkPhone, unlinkPhone } from "./phone-actions";

const log = createLogger("account.phone");

/** Every 4s while a code is waiting, for up to 10 minutes: the server polls Photon for the LINK text. */
const POLL_MS = 4000;
const POLL_FOR_MS = 10 * 60 * 1000;

export function PhoneCard({ view }: { view: PhoneView }) {
  const router = useRouter();
  const toast = useToast();
  const [handle, setHandle] = useState(view.handle ?? "");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(view.status === "pending" && !!view.code);

  useEffect(() => {
    if (!waiting) return;
    log.info("waiting for the LINK text, polling the inbound sync");
    const started = performance.now();
    const id = setInterval(async () => {
      if (performance.now() - started > POLL_FOR_MS) {
        log.info("stopped waiting for the LINK text after 10 minutes");
        setWaiting(false);
        return;
      }
      try {
        const r = await apiFetch<{ outcomes: Record<string, number> }>("/api/photon/sync", { method: "POST" });
        if (r.outcomes.linked) {
          log.info("a LINK text was handled, reloading the account page");
          setWaiting(false);
          router.refresh();
        }
      } catch (err) {
        log.warn("inbound sync failed while waiting for LINK (will try again)", { err });
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [waiting, router]);

  async function start() {
    setBusy(true);
    try {
      await runAction("phone.link", linkPhone, { handle });
      setWaiting(true);
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      toast.show({ kind: "error", title: "Could not start linking", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await runAction("phone.unlink", unlinkPhone, undefined);
      setWaiting(false);
      setHandle("");
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      toast.show({ kind: "error", title: "Could not unlink", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  if (!view.configured) {
    return <p className="text-sm text-muted">Texting is turned on but this server has no Photon project yet (PHOTON_API_KEY, PHOTON_PROJECT_ID, PHOTON_AGENT_HANDLE).</p>;
  }

  if (view.status === "linked") {
    return (
      <div className="grid gap-3 text-sm">
        <p>
          Linked: <span className="font-mono">{view.handle}</span>. On a ready draft, use <span className="font-medium">Text it to my phone</span>, send it from your own app, then reply <span className="font-mono">SENT</span>.
        </p>
        <div>
          <Button onClick={stop} disabled={busy}>
            Unlink this number
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 text-sm">
      <p className="text-muted">
        Get a finished draft as a text on your own phone, send it from your real messaging app, and reply SENT to mark it sent. Altostratus never texts anyone else, and never texts you first: you start by texting a code from that number.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <Field label="Your phone number or iMessage email" htmlFor="phone-handle" hint="With the country code, like +14155550123.">
          <Input id="phone-handle" value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="tel" className="w-64 max-w-full" />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || handle.trim().length < 6}>
          {view.status === "pending" ? "Get a new code" : "Get a code"}
        </Button>
      </form>
      {view.status === "pending" && view.code ? (
        <div className="border border-line bg-sunken px-3 py-3">
          <p>
            From <span className="font-mono">{view.handle}</span>, text <span className="font-mono text-[15px] font-semibold">LINK {view.code}</span> to <span className="font-mono">{view.agentHandle}</span>.
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {waiting ? "Waiting for your text. This page checks every few seconds." : "Stopped waiting; reload this page after you text."} The code works until {new Date(view.codeExpiresAt!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>
        </div>
      ) : view.status === "pending" ? (
        <p className="text-[13px] text-muted">The last code expired. Get a new one.</p>
      ) : null}
    </div>
  );
}
