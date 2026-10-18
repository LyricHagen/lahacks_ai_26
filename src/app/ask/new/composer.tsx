"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { type AskUrgency, URGENCIES, URGENCY_HINT, URGENCY_LABEL } from "@/lib/ask-state";
import { createLogger } from "@/lib/client-log";
import { createAsk } from "../actions";

const log = createLogger("ask.compose");

type Example = { id: string; label: string; body: string; tried: string; urgency: AskUrgency };

export function Composer({ examples, limits }: { examples: Example[]; limits: { bodyMin: number; bodyMax: number; extraMax: number } }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [tried, setTried] = useState("");
  const [urgency, setUrgency] = useState<AskUrgency>("blocked_today");
  const [confidential, setConfidential] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = body.trim().length < limits.bodyMin;

  function applyExample(e: Example) {
    log.info(`example "${e.id}" clicked, filling the composer`, { urgency: e.urgency, hasTried: !!e.tried });
    setBody(e.body);
    setTried(e.tried);
    setUrgency(e.urgency);
    setError(null);
    if (e.tried || e.urgency !== "blocked_today") setOpen(true);
  }

  async function submit() {
    if (tooShort) {
      log.info("submit blocked: description too short", { chars: body.trim().length });
      setError(`Write at least ${limits.bodyMin} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    log.info("submitting ask", { bodyChars: body.length, triedChars: tried.length, urgency, hasConfidentialNote: !!confidential.trim(), detailsOpen: open });
    try {
      const r = await runAction("ask.create", createAsk, { body, tried, urgency, confidential });
      log.info(`created ${r.askId}, opening it`, { askId: r.askId, state: r.state });
      router.push(`/ask/${r.askId}`);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("create ask failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not submit the ask", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <Field
        label="In your own words"
        htmlFor="ask-body"
        error={error}
        hint={
          <span className="flex justify-between gap-4">
            <span>Mention the service, error or doc if you know it. Ctrl+Enter submits.</span>
            <span className="font-mono">
              {body.length}/{limits.bodyMax}
            </span>
          </span>
        }
      >
        <Textarea
          id="ask-body"
          rows={8}
          value={body}
          maxLength={limits.bodyMax}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="My deploy keeps failing at..."
          className="text-[15px]"
          aria-invalid={error ? true : undefined}
          autoFocus
        />
      </Field>
      <p className="-mt-3 text-[13px] text-muted">
        Data note: in live mode this text goes to a model provider to read it; emails, phone numbers, secrets and personal sentences are flagged and kept
        out of the draft. Details in the <a href="/privacy#model-providers">privacy policy</a>.
      </p>

      {examples.length ? (
        <div>
          <p className="mb-2 text-[13px] text-muted">Or start from a real situation at Ferndale:</p>
          <ul className="flex flex-wrap gap-2">
            {examples.map((e) => (
              <li key={e.id}>
                <Button size="sm" onClick={() => applyExample(e)} title={e.body}>
                  {e.label}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details
        open={open}
        onToggle={(e) => {
          const next = (e.currentTarget as HTMLDetailsElement).open;
          if (next !== open) {
            log.debug(`optional fields ${next ? "opened" : "closed"}`);
            setOpen(next);
          }
        }}
        className="border border-line bg-raised"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
          <span>
            <span className="font-medium">More detail</span>
            <span className="text-muted"> (optional): what you tried, how urgent, what to leave out</span>
          </span>
          <span className="font-mono text-[12px] text-muted">{open ? "Hide" : "Show"}</span>
        </summary>
        <div className="flex flex-col gap-6 border-t border-line px-4 py-5">
          <Field label="What I already tried" htmlFor="ask-tried" hint="Goes into the draft so nobody suggests it again.">
            <Textarea id="ask-tried" rows={3} value={tried} maxLength={limits.extraMax} onChange={(e) => setTried(e.target.value)} />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">How urgent</legend>
            {URGENCIES.map((u) => (
              <label key={u} className="flex cursor-pointer items-start gap-3 border border-line px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="radio" name="urgency" value={u} checked={urgency === u} onChange={() => setUrgency(u)} className="mt-1 accent-[var(--accent)]" />
                <span className="text-sm">
                  <span className="font-medium">{URGENCY_LABEL[u]}</span>
                  <span className="block text-[13px] text-muted">{URGENCY_HINT[u]}</span>
                </span>
              </label>
            ))}
            <p className="text-[13px] text-muted">Lower urgency means Altostratus prefers an asynchronous message over taking someone&apos;s time.</p>
          </fieldset>

          <Field
            label="Anything confidential I should leave out of the draft"
            htmlFor="ask-confidential"
            hint="Used only to keep it out of the message. It is never shown to the person you ask, never sent to a model and never written to logs."
          >
            <Textarea id="ask-confidential" rows={2} value={confidential} maxLength={limits.extraMax} onChange={(e) => setConfidential(e.target.value)} />
          </Field>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={busy || !body.trim()}>
          {busy ? "Submitting..." : "Find who to ask"}
        </Button>
        <span className="text-[13px] text-muted">
          Urgency: <span className="text-fg">{URGENCY_LABEL[urgency]}</span>
        </span>
      </div>
    </form>
  );
}
