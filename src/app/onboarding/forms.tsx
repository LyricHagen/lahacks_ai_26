"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { confirmRole, saveChannels, saveContext, skipOnboarding, switchPersona } from "./actions";

const log = createLogger("onboarding");

type Step = "role" | "context" | "channels";

function useSubmit() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function go<T>(what: string, fn: () => Promise<T>, failTitle: string): Promise<T | null> {
    setBusy(what);
    try {
      const r = await fn();
      const next = (r as { next?: string } | null)?.next;
      if (next) {
        log.info(`${what} saved, going to ${next}`);
        router.push(next);
      } else {
        router.refresh();
        setBusy(null);
      }
      return r;
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${what} failed`, { err, code: e?.code });
      toast.show({ kind: "error", title: failTitle, body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
      setBusy(null);
      return null;
    }
  }
  return { busy, go };
}

export function SkipControls({ step }: { step: Step }) {
  const { busy, go } = useSubmit();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => go(`skip ${step}`, () => runAction("onboarding.skip", skipOnboarding, { step }), "Could not skip")}>
        {busy === `skip ${step}` ? "Skipping..." : "Skip this step"}
      </Button>
      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => go("skip rest", () => runAction("onboarding.skip", skipOnboarding, { step: "rest" }), "Could not skip")}>
        {busy === "skip rest" ? "Skipping..." : "Skip the rest, use defaults"}
      </Button>
    </div>
  );
}

export type PersonaOpt = { id: string; label: string; team: string; current: boolean };

export function RoleForm({ personas, currentId }: { personas: PersonaOpt[]; currentId: string | null }) {
  const { busy, go } = useSubmit();
  const [pick, setPick] = useState(currentId ?? "");
  const teams = useMemo(() => [...new Set(personas.map((p) => p.team))], [personas]);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" disabled={!!busy || !currentId} onClick={() => go("confirm role", () => runAction("onboarding.role", confirmRole, undefined), "Could not save")}>
          {busy === "confirm role" ? "Saving..." : "Yes, this is me"}
        </Button>
      </div>
      <form
        className="flex flex-col gap-3 border-t border-line pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          log.info(`persona switch requested to ${pick}`, { from: currentId, to: pick });
          void go("switch persona", () => runAction("onboarding.persona", switchPersona, { employeeId: pick }), "Could not switch persona");
        }}
      >
        <Field
          label="Or play someone else"
          htmlFor="persona"
          hint="Every junior or mid-level colleague nobody else is playing. Pick a backend team (Payments, Identity, Platform) to be a new backend engineer."
        >
          <Select id="persona" value={pick} onChange={(e) => setPick(e.target.value)}>
            {teams.map((team) => (
              <optgroup key={team} label={team}>
                {personas
                  .filter((p) => p.team === team)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.current ? " (you now)" : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <div>
          <Button type="submit" disabled={!!busy || !pick || pick === currentId}>
            {busy === "switch persona" ? "Switching..." : "Play this person instead"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ContextForm({
  groups,
  initialKnown,
  initialFocus,
  focusMax,
}: {
  groups: Array<{ category: string; skills: Array<{ id: string; name: string }> }>;
  initialKnown: string[];
  initialFocus: string;
  focusMax: number;
}) {
  const { busy, go } = useSubmit();
  const [known, setKnown] = useState<Set<string>>(new Set(initialKnown));
  const [focus, setFocus] = useState(initialFocus);
  const toggle = (id: string) =>
    setKnown((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        log.info("saving context", { knownSkills: known.size, focusChars: focus.length });
        void go("save context", () => runAction("onboarding.context", saveContext, { knownSkillIds: [...known], firstFocus: focus }), "Could not save");
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium">What you already know</legend>
        <p className="mb-3 mt-1 text-[13px] text-muted">
          Things nobody needs to explain to you. Who2Ask will not send you to someone just to learn these. <span className="font-mono">{known.size}</span> selected.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.category} className="border border-line bg-raised px-3 py-2">
              <p className="mb-1 font-mono text-[11px] uppercase text-muted">{g.category}</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {g.skills.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={known.has(s.id)} onChange={() => toggle(s.id)} className="accent-[var(--accent)]" />
                      {s.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </fieldset>
      <Field label="What you are working on first" htmlFor="focus" hint={`A sentence or two. ${focus.length}/${focusMax}`}>
        <Textarea id="focus" rows={3} value={focus} maxLength={focusMax} onChange={(e) => setFocus(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={!!busy}>
          {busy ? "Saving..." : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}

export function ChannelsForm({
  channels,
  initialChannel,
  initialInterrupt,
}: {
  channels: Array<{ id: string; label: string; hint: string }>;
  initialChannel: string;
  initialInterrupt: boolean;
}) {
  const { busy, go } = useSubmit();
  const [channel, setChannel] = useState(initialChannel);
  const [interrupt, setInterrupt] = useState(initialInterrupt);
  const radio = "flex cursor-pointer items-start gap-3 border border-line px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft";
  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        void go("save channels", () => runAction("onboarding.channels", saveChannels, { preferredChannel: channel, okToInterruptSeniors: interrupt }), "Could not save");
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">How you prefer to reach people</legend>
        {channels.map((c) => (
          <label key={c.id} className={radio}>
            <input type="radio" name="channel" value={c.id} checked={channel === c.id} onChange={() => setChannel(c.id)} className="mt-1 accent-[var(--accent)]" />
            <span className="text-sm">
              <span className="font-medium">{c.label}</span>
              <span className="block text-[13px] text-muted">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Are you comfortable interrupting senior people?</legend>
        <label className={radio}>
          <input type="radio" name="interrupt" checked={interrupt} onChange={() => setInterrupt(true)} className="mt-1 accent-[var(--accent)]" />
          <span className="text-sm">
            <span className="font-medium">Yes</span>
            <span className="block text-[13px] text-muted">If a staff engineer or manager is the best person, suggest them first.</span>
          </span>
        </label>
        <label className={radio}>
          <input type="radio" name="interrupt" checked={!interrupt} onChange={() => setInterrupt(false)} className="mt-1 accent-[var(--accent)]" />
          <span className="text-sm">
            <span className="font-medium">Not yet</span>
            <span className="block text-[13px] text-muted">Prefer peers first, and write gentler, asynchronous messages to senior people.</span>
          </span>
        </label>
      </fieldset>
      <div>
        <Button type="submit" variant="primary" disabled={!!busy}>
          {busy ? "Saving..." : "Finish"}
        </Button>
      </div>
    </form>
  );
}
