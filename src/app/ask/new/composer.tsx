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

type Shot = { name: string; mime: string; dataBase64: string; bytes: number; previewUrl: string; note: string };

const SAMPLE_SHOT = { url: "/samples/billing-webhook-error.png", name: "Sample: billing-service webhook error (kubectl logs)" };
const MAX_SIDE = 1600;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("could not read the file"));
    r.readAsDataURL(blob);
  });
}

/** The image as sent: as is when small enough, else scaled to 1600px on its long side as JPEG. */
async function prepareShot(file: Blob, name: string, maxBytes: number): Promise<Shot> {
  const okType = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  if (okType && file.size <= maxBytes && Math.max(width, height) <= MAX_SIDE * 1.5) {
    bitmap.close();
    log.info(`screenshot kept as is: ${file.type} ${width}x${height}, ${file.size} bytes`);
    return { name, mime: file.type, dataBase64: await toBase64(file), bytes: file.size, previewUrl: URL.createObjectURL(file), note: `${width} x ${height}, ${Math.round(file.size / 1000)} KB` };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the image"))), "image/jpeg", 0.85));
  log.info(`screenshot scaled: ${file.type || "unknown type"} ${width}x${height} ${file.size} bytes -> image/jpeg ${canvas.width}x${canvas.height} ${blob.size} bytes`);
  if (blob.size > maxBytes) throw new Error(`Still ${Math.round(blob.size / 1000)} KB after scaling; crop it and try again.`);
  return { name, mime: "image/jpeg", dataBase64: await toBase64(blob), bytes: blob.size, previewUrl: URL.createObjectURL(blob), note: `scaled to ${canvas.width} x ${canvas.height}, ${Math.round(blob.size / 1000)} KB` };
}

export function Composer({
  examples,
  limits,
  screenshot: screenshotOn,
  live,
}: {
  examples: Example[];
  limits: { bodyMin: number; bodyMax: number; extraMax: number; screenshotBytes: number };
  /** FEATURE_STEPFUN_VISION: offer the screenshot field. */
  screenshot: boolean;
  live: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [tried, setTried] = useState("");
  const [urgency, setUrgency] = useState<AskUrgency>("blocked_today");
  const [confidential, setConfidential] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [shotBusy, setShotBusy] = useState(false);

  async function attach(file: Blob, name: string) {
    setShotBusy(true);
    setShotError(null);
    try {
      const next = await prepareShot(file, name, limits.screenshotBytes);
      if (shot) URL.revokeObjectURL(shot.previewUrl);
      setShot(next);
    } catch (err) {
      log.warn("screenshot not attached", { err });
      setShotError(err instanceof Error ? err.message : "That image could not be read.");
    } finally {
      setShotBusy(false);
    }
  }

  async function attachSample() {
    log.info("sample screenshot requested", { url: SAMPLE_SHOT.url });
    try {
      const res = await fetch(SAMPLE_SHOT.url);
      if (!res.ok) throw new Error(`sample screenshot answered ${res.status}`);
      await attach(await res.blob(), SAMPLE_SHOT.name);
    } catch (err) {
      log.error("sample screenshot failed to load", { err });
      setShotError("The sample screenshot could not be loaded.");
    }
  }

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
    log.info("submitting ask", { bodyChars: body.length, triedChars: tried.length, urgency, hasConfidentialNote: !!confidential.trim(), detailsOpen: open, screenshot: shot ? `${shot.mime} ${shot.bytes} bytes` : null });
    try {
      const r = await runAction("ask.create", createAsk, { body, tried, urgency, confidential, ...(shot ? { screenshot: { mime: shot.mime, dataBase64: shot.dataBase64 } } : {}) });
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

      {screenshotOn ? (
        <div className="border border-line bg-raised px-4 py-3">
          <p className="text-sm font-medium">
            Screenshot <span className="font-normal text-muted">(optional): an error page, stack trace or dashboard</span>
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            StepFun step-5-preview reads the service names and error messages off it, the same way your words are read. {live ? "The image goes to StepFun and is deleted from Altostratus once read." : "Demo mode can only read the sample screenshot; other images are kept out of any model and deleted."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center border border-line-strong bg-bg px-3 text-[13px] focus-within:border-accent">
              <span>{shot ? "Replace image" : "Choose image"}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={shotBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void attach(f, f.name);
                }}
              />
            </label>
            <Button size="sm" onClick={() => void attachSample()} disabled={shotBusy}>
              Use the sample screenshot
            </Button>
            {shot ? (
              <Button
                size="sm"
                onClick={() => {
                  log.info("screenshot removed");
                  URL.revokeObjectURL(shot.previewUrl);
                  setShot(null);
                }}
              >
                Remove
              </Button>
            ) : null}
            {shotBusy ? <span className="text-[13px] text-muted">Preparing...</span> : null}
          </div>
          {shotError ? <p className="mt-2 text-[13px] text-danger">{shotError}</p> : null}
          {shot ? (
            <figure className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a static asset */}
              <img src={shot.previewUrl} alt={`Attached screenshot: ${shot.name}`} className="max-h-48 max-w-full border border-line" />
              <figcaption className="mt-1 font-mono text-[12px] text-muted">
                {shot.name}, {shot.note}
              </figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}

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
