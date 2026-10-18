"use client";
// The draft editor. DraftProvider lives in /ask/[askId]/draft/layout.tsx, so the text of all three
// variants survives switching tabs (each tab is its own URL under that layout); every edit is also
// autosaved, so a reload keeps it. The workspace never sends anything: it copies, and the asker
// says when they sent it.

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { backToShortlist, copyDraft, markSent, saveDraft } from "@/app/ask/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { copyText, type DraftFormat, type DraftText, type DraftVariant, DRAFT_FORMATS, DRAFT_VARIANTS, FORMAT_APP, FORMAT_LABEL, VARIANT_DEF, WORD_LIMIT, wordCount } from "@/lib/draft";
import { MessageMock } from "./message-mock";

const log = createLogger("ask.draft");

const SAVE_DEBOUNCE_MS = 800;

export type DraftClientData = {
  askId: string;
  readOnly: boolean;
  /** Why it is read only ("Sent on ..."), shown instead of the send controls. */
  readOnlyReason: string | null;
  asker: { name: string };
  recipient: { id: string; name: string; firstName: string; slackHandle: string; email: string };
  suggested: { variant: DraftVariant; format: DraftFormat };
  sentVariant: DraftVariant | null;
  slotLabel: string | null;
  load: { count: number; max: number } | null;
  texts: Record<DraftVariant, DraftText>;
  originals: Record<DraftVariant, DraftText>;
  format: DraftFormat;
};

type Ctx = {
  data: DraftClientData;
  texts: Record<DraftVariant, DraftText>;
  format: DraftFormat;
  setFormat: (f: DraftFormat) => void;
  edit: (v: DraftVariant, patch: Partial<DraftText>) => void;
  reset: (v: DraftVariant) => void;
  saving: Record<DraftVariant, "idle" | "pending" | "saved" | "failed">;
  flush: () => void;
};

const DraftCtx = createContext<Ctx | null>(null);

export function DraftProvider({ data, children }: { data: DraftClientData; children: ReactNode }) {
  const [texts, setTexts] = useState(data.texts);
  const [format, setFormatState] = useState<DraftFormat>(data.format);
  const [saving, setSaving] = useState<Ctx["saving"]>({ short: "idle", full: "idle", call: "idle" });
  const timers = useRef<Partial<Record<DraftVariant, ReturnType<typeof setTimeout>>>>({});
  const latest = useRef({ texts, format });
  latest.current = { texts, format };

  const save = useCallback(
    async (v: DraftVariant) => {
      if (data.readOnly) return;
      const t = latest.current.texts[v];
      setSaving((s) => ({ ...s, [v]: "pending" }));
      try {
        await runAction("ask.draft.save", saveDraft, { askId: data.askId, variant: v, format: latest.current.format, subject: t.subject, body: t.body });
        setSaving((s) => ({ ...s, [v]: "saved" }));
      } catch (err) {
        const e = err instanceof ApiError ? err : null;
        log.error(`${data.askId} autosave of ${v} failed`, { err, code: e?.code });
        setSaving((s) => ({ ...s, [v]: "failed" }));
      }
    },
    [data.askId, data.readOnly],
  );

  const schedule = useCallback(
    (v: DraftVariant) => {
      if (timers.current[v]) clearTimeout(timers.current[v]);
      timers.current[v] = setTimeout(() => {
        timers.current[v] = undefined;
        void save(v);
      }, SAVE_DEBOUNCE_MS);
    },
    [save],
  );

  const flush = useCallback(() => {
    for (const v of DRAFT_VARIANTS) {
      if (timers.current[v]) {
        clearTimeout(timers.current[v]);
        timers.current[v] = undefined;
        void save(v);
      }
    }
  }, [save]);

  useEffect(() => () => flush(), [flush]);

  const value = useMemo<Ctx>(
    () => ({
      data,
      texts,
      format,
      saving,
      flush,
      setFormat: (f) => {
        log.info(`${data.askId} format ${format} -> ${f}`, { askId: data.askId });
        setFormatState(f);
      },
      edit: (v, patch) => {
        setTexts((all) => ({ ...all, [v]: { ...all[v], ...patch } }));
        schedule(v);
      },
      reset: (v) => {
        log.info(`${data.askId} reset ${v} to the drafted text`, { askId: data.askId });
        setTexts((all) => ({ ...all, [v]: data.originals[v] }));
        schedule(v);
      },
    }),
    [data, texts, format, saving, flush, schedule],
  );
  return <DraftCtx.Provider value={value}>{children}</DraftCtx.Provider>;
}

function useDraft(): Ctx {
  const c = useContext(DraftCtx);
  if (!c) throw new Error("DraftWorkspace must be inside DraftProvider");
  return c;
}

/** Saves pending edits before a tab link navigates (the provider keeps the text either way). */
export function DraftFlushOnNavigate({ children }: { children: ReactNode }) {
  const { flush } = useDraft();
  return (
    <div onClickCapture={(e) => (e.target as HTMLElement).closest("a") && flush()} className="contents">
      {children}
    </div>
  );
}

function FormatPicker() {
  const { format, setFormat, data } = useDraft();
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <legend className="sr-only">Show the draft as</legend>
      <span className="text-[13px] text-muted">Show as</span>
      <div className="flex border border-line-strong">
        {DRAFT_FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={format === f}
            onClick={() => setFormat(f)}
            className={`h-8 border-r border-line-strong px-3 text-[13px] last:border-r-0 ${format === f ? "bg-strong font-semibold text-fg" : "bg-raised text-muted"}`}
          >
            {FORMAT_LABEL[f]}
            {f === data.suggested.format ? <span className="ml-1 font-normal text-subtle">(suggested)</span> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function DraftWorkspace({ variant }: { variant: DraftVariant }) {
  const { data, texts, format, edit, reset, saving } = useDraft();
  const router = useRouter();
  const toast = useToast();
  const text = texts[variant];
  const words = wordCount(text.body);
  const chars = text.body.length;
  const edited = text.body !== data.originals[variant].body || text.subject !== data.originals[variant].subject;
  const when = format === "invite" ? data.slotLabel : null;
  const [copied, setCopied] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const over = words > WORD_LIMIT;
  const loggedOver = useRef(false);

  useEffect(() => {
    if (over && !loggedOver.current) log.info(`${data.askId} ${variant} is over ${WORD_LIMIT} words (${words}), warning shown`, { askId: data.askId });
    loggedOver.current = over;
  }, [over, words, variant, data.askId]);

  useEffect(() => setCopied(false), [variant, format]);

  async function copy() {
    const out = copyText(format, text.subject, text.body, when);
    try {
      await navigator.clipboard.writeText(out);
      setCopied(true);
      log.info(`${data.askId} copied ${variant} as ${format}: ${wordCount(out)} words, ${out.length} chars`, { askId: data.askId });
      void runAction("ask.draft.copy", copyDraft, { askId: data.askId, variant, format, subject: text.subject, body: text.body }).catch((err) => log.error(`${data.askId} copy note failed`, { err }));
    } catch (err) {
      log.error(`${data.askId} clipboard write failed`, { err });
      toast.show({ kind: "error", title: "Could not copy", body: "Your browser blocked the clipboard. Select the text and copy it by hand.", code: "CLIENT_CLIPBOARD" });
    }
  }

  async function sent() {
    setBusy(true);
    try {
      const r = await runAction("ask.sent", markSent, { askId: data.askId, variant, format, subject: text.subject, body: text.body });
      log.info(`${data.askId} marked sent to ${r.recipientId}: load ${r.loadBefore} -> ${r.loadAfter} of ${r.max}`, { askId: data.askId });
      router.push(`/ask/${data.askId}`);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${data.askId} mark sent failed`, { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not mark it sent", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
      setBusy(false);
    }
  }

  async function pickOther() {
    setBusy(true);
    try {
      await runAction("ask.reshortlist", backToShortlist, { askId: data.askId });
      router.push(`/ask/${data.askId}`);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${data.askId} back to shortlist failed`, { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not go back to the shortlist", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
      setBusy(false);
    }
  }

  const statusLabel = data.readOnly ? (data.sentVariant === variant ? "Sent by you" : "Not sent") : "Draft, not sent";
  const app = FORMAT_APP[format];
  const where = format === "slack" ? `to ${data.recipient.slackHandle}` : format === "email" ? `to ${data.recipient.email}` : `with ${data.recipient.name} as the guest`;
  const saveNote = saving[variant] === "pending" ? "saving" : saving[variant] === "failed" ? "not saved, check the log" : saving[variant] === "saved" ? "saved" : edited ? "edited" : "as drafted";

  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-muted">
        <span className="font-medium text-fg">{VARIANT_DEF[variant].forWhom}.</span> {VARIANT_DEF[variant].shape}
      </p>
      <FormatPicker />
      <MessageMock
        format={format}
        subject={text.subject}
        body={text.body}
        when={when}
        readOnly={data.readOnly}
        statusLabel={statusLabel}
        asker={data.asker}
        recipient={data.recipient}
        onSubject={(subject) => edit(variant, { subject })}
        onBody={(body) => edit(variant, { body })}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-[12px] text-muted" aria-live="polite">
          <span className={over ? "font-semibold text-danger" : ""}>{words} words</span>, {chars} characters{data.readOnly ? "" : `, ${saveNote}`}
        </p>
        {edited && !data.readOnly ? (
          <Button size="sm" variant="ghost" onClick={() => reset(variant)}>
            Undo my edits
          </Button>
        ) : null}
      </div>
      {over ? (
        <p className="border border-danger bg-danger-soft px-3 py-2 text-[13px]" role="status">
          <span className="font-semibold text-danger">Long: </span>
          This is {words} words. Asks over about {WORD_LIMIT} words tend to get skimmed or left for later. Cut it to the question and what you need from {data.recipient.firstName}.
        </p>
      ) : null}

      <ol className="grid gap-3 border border-line bg-sunken px-4 py-4 text-sm">
        <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2">
          <span className="font-mono text-[13px] text-muted">1</span>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <span className="text-[13px] text-muted">{copied ? "On your clipboard, exactly as shown above." : "Copies exactly what is shown above."}</span>
          </div>
        </li>
        <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
          <span className="font-mono text-[13px] text-muted">2</span>
          <p>
            Open {app} and send it {where} yourself. Who2Ask has no access to {app} and cannot send it for you.
          </p>
        </li>
        <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2">
          <span className="font-mono text-[13px] text-muted">3</span>
          {data.readOnly ? (
            <p className="text-muted">{data.readOnlyReason}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setConfirmSend(true)} disabled={busy}>
                I sent this
              </Button>
              <span className="text-[13px] text-muted">Only after you have sent it. This is how {data.recipient.firstName}&apos;s asks this week are counted.</span>
            </div>
          )}
        </li>
      </ol>
      {!data.readOnly ? (
        <p className="text-[13px] text-muted">
          Changed your mind?{" "}
          <button type="button" className="underline" onClick={pickOther} disabled={busy}>
            Pick someone else from the shortlist
          </button>
          . Nothing has been sent.
        </p>
      ) : null}

      <Dialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        title={`Did you send it to ${data.recipient.firstName}?`}
        footer={
          <>
            <Button onClick={() => setConfirmSend(false)}>Not yet</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                setConfirmSend(false);
                log.info(`${data.askId} I sent this confirmed for ${variant} as ${format}`, { askId: data.askId });
                void sent();
              }}
            >
              Yes, I sent it
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          <p>Who2Ask has not sent anything. Say yes only once the message is in {app}.</p>
          {data.load ? (
            <p>
              It counts toward {data.recipient.firstName}&apos;s asks this week:{" "}
              <span className="font-mono">
                {data.load.count} of {data.load.max}
              </span>{" "}
              now,{" "}
              <span className="font-mono">
                {data.load.count + 1} of {data.load.max}
              </span>{" "}
              after.
              {data.load.count + 1 >= data.load.max ? ` That is their weekly limit, so the next ask about this goes to someone else.` : ""}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
