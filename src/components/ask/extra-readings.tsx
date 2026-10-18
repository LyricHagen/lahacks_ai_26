import type { Understanding } from "@/lib/understanding";

const GLOSSARY_VIA = {
  creao: "Read by the CREAO glossary agent.",
  recorded: "Recorded glossary agent answer, replayed in demo mode.",
  local: "Exact matches against the company glossary (no agent in demo mode).",
} as const;

const SHOT_VIA = {
  stepfun: "Read by StepFun step-5-preview.",
  recorded: "Recorded step-5-preview reading, replayed in demo mode.",
  sample: "Cached step-5-preview reading of the sample screenshot.",
  none: "Not read.",
} as const;

/** What the glossary agent and the screenshot reader added to an ask. Renders nothing when neither ran. */
export function ExtraReadings({ u }: { u: Understanding }) {
  const g = u.glossary;
  const s = u.screenshot;
  if (!g && !s) return null;
  return (
    <div className="mb-3 grid gap-2">
      {g ? (
        <div className="border border-line bg-sunken px-3 py-2 text-[13px]">
          <p className="font-medium">Company terms</p>
          {g.hits.length ? (
            <ul className="mt-1 grid gap-1">
              {g.hits.map((h) => (
                <li key={h.glossaryId}>
                  <span className="font-mono text-[12px]">&ldquo;{h.phrase}&rdquo;</span> means {h.means}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">No company jargon found in your ask.</p>
          )}
          {g.unknown.length ? <p className="mt-1 text-muted">Not in the glossary: {g.unknown.map((x) => `"${x}"`).join(", ")}. Add the service yourself if you know it.</p> : null}
          <p className="mt-1 font-mono text-[12px] text-muted">
            {GLOSSARY_VIA[g.via]}
            {g.note ? ` ${g.note}` : ""}
          </p>
        </div>
      ) : null}
      {s ? (
        <div className="border border-line bg-sunken px-3 py-2 text-[13px]">
          <p className="font-medium">Your screenshot</p>
          {s.via === "none" ? (
            <p className="mt-1 text-muted">{s.note}</p>
          ) : (
            <>
              {s.summary ? <p className="mt-1">{s.summary}</p> : null}
              {s.errors.length ? (
                <ul className="mt-1 grid gap-1">
                  {s.errors.map((e) => (
                    <li key={e} className="break-words font-mono text-[12px]">
                      {e}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-muted">
                Added {s.added.services.length} service{s.added.services.length === 1 ? "" : "s"}, {s.added.skills.length} skill{s.added.skills.length === 1 ? "" : "s"} and {s.added.artifacts} detail{s.added.artifacts === 1 ? "" : "s"} to what you wrote. The image itself was deleted after reading.
              </p>
              <p className="mt-1 font-mono text-[12px] text-muted">
                {SHOT_VIA[s.via]} {s.ms >= 1000 ? `${(s.ms / 1000).toFixed(1)}s` : `${s.ms}ms`}.{s.note ? ` ${s.note}` : ""}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
