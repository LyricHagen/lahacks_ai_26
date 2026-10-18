"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { confirmAsk } from "@/app/ask/actions";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import type { DocCheckView } from "@/lib/ask-review";
import { URGENCIES, URGENCY_LABEL } from "@/lib/ask-state";
import { createLogger } from "@/lib/client-log";
import { ARTIFACT_KINDS, ARTIFACT_LABEL, type ArtifactKind, HELP_KIND_LABEL, HELP_KINDS, type Understanding } from "@/lib/understanding";
import { DocQuote } from "./doc-quote";
import { ExtraReadings } from "./extra-readings";

const log = createLogger("ask.confirm");

type Option = { id: string; name: string };

const VIA_LINE = {
  model: "Read by the model.",
  fixture: "Cached demo reading for this example question.",
  keywords: "Read by matching the company's service and skill names (no model).",
} as const;

function Chip({ label, title, onRemove, disabled }: { label: ReactNode; title?: string; onRemove: () => void; disabled?: boolean }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 border border-line-strong bg-sunken pl-2 text-[13px]" title={title}>
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${typeof label === "string" ? label : "this"}`}
        className="inline-flex h-full w-7 items-center justify-center border-l border-line-strong text-muted transition-colors duration-100 focus-visible:outline-2 active:text-fg disabled:opacity-50"
      >
        <IconClose />
      </button>
    </span>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-line py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * The confirming state: what Altostratus understood as editable chips, then the document check. The
 * search uses exactly what is confirmed here, so a wrong parse is fixed before anyone is searched.
 */
export function ConfirmPanel({ askId, u, docs, services, skills, canAct }: { askId: string; u: Understanding; docs: DocCheckView[]; services: Option[]; skills: Option[]; canAct: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [restatement, setRestatement] = useState(u.restatement);
  const [svc, setSvc] = useState(u.services.map((s) => ({ id: s.id, name: s.name, matched: s.matched })));
  const [skl, setSkl] = useState(u.skills.map((s) => ({ id: s.id, name: s.name, matched: s.matched })));
  const [artifacts, setArtifacts] = useState(u.artifacts);
  const [helpKind, setHelpKind] = useState(u.helpKind);
  const [urgency, setUrgency] = useState(u.urgency);
  const [sensitive, setSensitive] = useState(u.sensitive);
  const [artKind, setArtKind] = useState<ArtifactKind>("error");
  const [artText, setArtText] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const locked = !canAct || busy !== null;

  async function submit(answeredByDocId: string | null) {
    const which = answeredByDocId ? `doc ${answeredByDocId} answered it` : "find a person";
    log.info(`${askId} confirm: ${which}`, { askId, services: svc.map((s) => s.id), skills: skl.map((s) => s.id), helpKind, urgency, artifacts: artifacts.length });
    setBusy(answeredByDocId ?? "people");
    try {
      const r = await runAction("ask.confirm", confirmAsk, {
        askId,
        restatement: restatement.trim(),
        serviceIds: svc.map((s) => s.id),
        skillIds: skl.map((s) => s.id),
        artifacts,
        helpKind,
        urgency,
        sensitive,
        answeredByDocId,
      });
      log.info(`${askId} confirmed, now ${r.to}`, { askId });
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${askId} confirm failed`, { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not continue", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
      setBusy(null);
    }
  }

  const tooShort = restatement.trim().length < 8;

  return (
    <div className="grid gap-8">
      <section aria-labelledby="understood-h" className="border border-line bg-raised">
        <header className="border-b border-line px-4 py-3">
          <h2 id="understood-h" className="text-[15px] font-semibold">
            What Altostratus understood
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Remove anything wrong and add what is missing. The search uses exactly this.</p>
        </header>
        <div className="px-4 pb-1 pt-3">
          <label htmlFor="restatement" className="text-sm font-medium">
            In one sentence
          </label>
          <Textarea id="restatement" rows={2} className="mt-1.5" value={restatement} onChange={(e) => setRestatement(e.target.value)} disabled={locked} aria-invalid={tooShort} />
          <p className="mb-3 mt-1 text-[12px] text-muted">
            {VIA_LINE[u.via]}
            {u.note ? ` ${u.note}` : ""}
          </p>
          {u.parse ? <p className="-mt-2 mb-3 font-mono text-[12px] text-muted">{u.parse.line}</p> : null}
          <ExtraReadings u={u} />

          <Row label="Services" hint="Owners are searched first">
            {svc.map((s) => (
              <Chip key={s.id} label={s.name} title={`matched: ${s.matched}`} disabled={locked} onRemove={() => setSvc(svc.filter((x) => x.id !== s.id))} />
            ))}
            {!svc.length ? <span className="text-[13px] text-muted">none, people will be found by skill and wording</span> : null}
            <Select
              aria-label="Add a service"
              className="h-7 w-auto min-w-40 text-[13px]"
              value=""
              disabled={locked}
              onChange={(e) => {
                const hit = services.find((x) => x.id === e.target.value);
                if (hit) setSvc([...svc, { ...hit, matched: "added by you" }]);
              }}
            >
              <option value="">Add a service</option>
              {services
                .filter((o) => !svc.some((s) => s.id === o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </Select>
          </Row>

          <Row label="Skills">
            {skl.map((s) => (
              <Chip key={s.id} label={s.name} title={`matched: ${s.matched}`} disabled={locked} onRemove={() => setSkl(skl.filter((x) => x.id !== s.id))} />
            ))}
            {!skl.length ? <span className="text-[13px] text-muted">none</span> : null}
            <Select
              aria-label="Add a skill"
              className="h-7 w-auto min-w-40 text-[13px]"
              value=""
              disabled={locked}
              onChange={(e) => {
                const hit = skills.find((x) => x.id === e.target.value);
                if (hit) setSkl([...skl, { ...hit, matched: "added by you" }]);
              }}
            >
              <option value="">Add a skill</option>
              {skills
                .filter((o) => !skl.some((s) => s.id === o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </Select>
          </Row>

          <Row label="Mentioned" hint="Repo, error, dashboard, ticket">
            {artifacts.map((a, i) => (
              <Chip key={`${a.kind}-${a.text}`} label={`${ARTIFACT_LABEL[a.kind]}: ${a.text}`} disabled={locked} onRemove={() => setArtifacts(artifacts.filter((_, j) => j !== i))} />
            ))}
            <form
              className="flex w-full flex-wrap gap-1.5 sm:w-auto"
              onSubmit={(e) => {
                e.preventDefault();
                const text = artText.trim();
                if (!text) return;
                setArtifacts([...artifacts, { kind: artKind, text: text.slice(0, 200) }]);
                setArtText("");
              }}
            >
              <Select aria-label="Kind of thing mentioned" className="h-7 w-auto text-[13px]" value={artKind} disabled={locked} onChange={(e) => setArtKind(e.target.value as ArtifactKind)}>
                {ARTIFACT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ARTIFACT_LABEL[k]}
                  </option>
                ))}
              </Select>
              <Input aria-label="What was mentioned" className="h-7 w-48 min-w-0 flex-1 text-[13px]" placeholder="paste it here" value={artText} disabled={locked} onChange={(e) => setArtText(e.target.value)} />
              <Button type="submit" size="sm" disabled={locked || !artText.trim()}>
                Add
              </Button>
            </form>
          </Row>

          <Row label="Kind of help">
            <Select aria-label="Kind of help" className="h-8 w-auto text-[13px]" value={helpKind} disabled={locked} onChange={(e) => setHelpKind(e.target.value as typeof helpKind)}>
              {HELP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {HELP_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            <Select aria-label="Urgency" className="h-8 w-auto text-[13px]" value={urgency} disabled={locked} onChange={(e) => setUrgency(e.target.value as typeof urgency)}>
              {URGENCIES.map((k) => (
                <option key={k} value={k}>
                  {URGENCY_LABEL[k]}
                </option>
              ))}
            </Select>
          </Row>

          <Row label="Leave out" hint="Never put in a drafted message">
            {sensitive.map((s, i) => (
              <Chip key={s.text} label={s.text} title={s.why} disabled={locked} onRemove={() => setSensitive(sensitive.filter((_, j) => j !== i))} />
            ))}
            {!sensitive.length ? <span className="text-[13px] text-muted">nothing sensitive found</span> : null}
            <form
              className="flex w-full flex-wrap gap-1.5 sm:w-auto"
              onSubmit={(e) => {
                e.preventDefault();
                const text = secret.trim();
                if (!text) return;
                setSensitive([...sensitive, { text: text.slice(0, 300), why: "marked by you" }]);
                setSecret("");
              }}
            >
              <Input aria-label="Something else to leave out" className="h-7 w-48 min-w-0 flex-1 text-[13px]" placeholder="something else to leave out" value={secret} disabled={locked} onChange={(e) => setSecret(e.target.value)} />
              <Button type="submit" size="sm" disabled={locked || !secret.trim()}>
                Add
              </Button>
            </form>
          </Row>
        </div>
      </section>

      <section aria-labelledby="docs-h" className="grid gap-3">
        <div>
          <h2 id="docs-h" className="text-[15px] font-semibold">
            Before asking a person
          </h2>
          <p className="mt-1 text-sm">
            <span className="font-semibold">The best ask is the one nobody has to answer.</span>{" "}
            {docs.length ? "This may already be written down:" : "No runbook or onboarding doc covers this closely, so the next step is finding a person."}
          </p>
        </div>
        {docs.map((d) => (
          <DocQuote key={d.documentId} doc={d}>
            <div>
              <Button variant="secondary" size="sm" disabled={locked || tooShort} onClick={() => void submit(d.documentId)}>
                {busy === d.documentId ? "Saving..." : "Yes, this answers it"}
              </Button>
            </div>
          </DocQuote>
        ))}
        <div className="flex flex-wrap items-center gap-3 border border-line bg-sunken px-4 py-3">
          <Button variant="primary" disabled={locked || tooShort} onClick={() => void submit(null)}>
            {busy === "people" ? "Starting the search..." : docs.length ? "No, find a person" : "Find people"}
          </Button>
          <p className="text-[13px] text-muted">
            {tooShort
              ? "Write the sentence above first (at least a few words)."
              : docs.length
                ? "Saying a doc did not help is recorded, so its owners can see what new hires still have to ask."
                : "Searches owners, project history, skills, profiles and doc authors."}
          </p>
        </div>
        {!canAct ? <p className="text-[13px] text-muted">Read only: only the person who asked can continue.</p> : null}
      </section>
    </div>
  );
}
