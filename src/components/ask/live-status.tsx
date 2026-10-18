"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SkeletonCard, SkeletonList } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { ApiError, apiFetch } from "@/lib/api-client";
import { type AskState, ASK_STATE_DEFS, isProcessing } from "@/lib/ask-state";
import { createLogger } from "@/lib/client-log";
import type { RetrievalSummary } from "@/lib/retrieval-paths";
import { RetrievalCounts } from "./retrieval-counts";

const log = createLogger("ask.live");

/** Under the pipeline pacing (ASK_STEP_MIN_MS, 700ms by default), so every status line is seen. */
const POLL_MS = 400;

type StatusBody = { state: AskState; stepBuilt: boolean; progress: string | null; running: boolean; lastErrorCode: string | null; retrieval: RetrievalSummary | null };

/**
 * Shown while an ask is in a processing state. Starts the server run once (POST .../run, which
 * holds a lease so a second tab only watches), polls the status line, and refreshes the page as
 * soon as the ask leaves processing or reaches a step that is not built yet.
 */
export function LiveStatus({ askId, initialState, initialProgress, canRun }: { askId: string; initialState: AskState; initialProgress: string | null; canRun: boolean }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [line, setLine] = useState(initialProgress ?? "starting");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [retrieval, setRetrieval] = useState<RetrievalSummary | null>(null);
  const started = useRef(performance.now());

  useEffect(() => {
    let stopped = false;
    let pathsSeen = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (why: string, state?: AskState) => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      // A finished draft opens in the draft editor, its own URL.
      const draftPath = `/ask/${askId}/draft`;
      if (state === "ready" && !window.location.pathname.startsWith(draftPath)) {
        log.info(`${askId} live status done (${why}), opening the draft`, { askId });
        router.push(draftPath);
        return;
      }
      log.info(`${askId} live status done (${why}), refreshing the page`, { askId });
      router.refresh();
    };

    if (canRun) {
      log.info(`${askId} starting the processing run`, { askId, state: initialState });
      apiFetch<{ state: AskState; ran: string[]; stoppedBecause: string }>(`/api/asks/${askId}/run`, { method: "POST" })
        .then((r) => {
          // "already running" means another request (a second tab, or React strict mode's second
          // effect in dev) holds the lease: keep polling, the poll sees when it ends.
          log.info(`${askId} run returned in state ${r.state}: ${r.stoppedBecause}`, { askId, ran: r.ran });
          if (r.stoppedBecause !== "already running") finish(`run ended in ${r.state}`, r.state);
        })
        .catch((err) => {
          const e = err instanceof ApiError ? err : null;
          log.error(`${askId} run request failed`, { err, code: e?.code });
          if (!stopped && e) setError(e);
        });
    } else {
      log.branch(`${askId} watch only`, "viewer cannot run this ask (seeded or read only)");
    }

    const poll = async () => {
      if (stopped) return;
      try {
        const s = await apiFetch<StatusBody>(`/api/asks/${askId}`);
        setElapsed(Math.round((performance.now() - started.current) / 100) / 10);
        if (s.progress) setLine(s.progress);
        setState(s.state);
        if (s.state === "retrieving" && s.retrieval) {
          if (s.retrieval.paths.length !== pathsSeen) {
            pathsSeen = s.retrieval.paths.length;
            log.debug(`${askId} retrieval paths done: ${s.retrieval.paths.map((p) => `${p.path}=${p.people}`).join(" ") || "none yet"}`, { askId });
          }
          setRetrieval(s.retrieval);
        }
        if (!isProcessing(s.state)) return finish(`state is now ${s.state}`, s.state);
        if (!s.stepBuilt) return finish(`${s.state} step is not built yet`);
      } catch (err) {
        const e = err instanceof ApiError ? err : null;
        log.error(`${askId} status poll failed`, { err, code: e?.code });
        if (e) setError(e);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [askId, canRun, initialState, router]);

  if (error) {
    return <ErrorState title="Could not follow this ask" code={error.code} reqId={error.reqId} body={error.message} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border border-line bg-sunken px-4 py-3" role="status" aria-live="polite">
        <p className="text-sm">
          <span className="font-semibold">{ASK_STATE_DEFS[state].label}</span>
          <span className="text-muted">: </span>
          <span className="font-mono text-[13px]">{line}</span>
        </p>
        <span className="font-mono text-[12px] text-muted">{elapsed.toFixed(1)}s</span>
      </div>
      {state === "retrieving" ? (
        <>
          <p className="text-[13px] text-muted">People found so far, by where the evidence came from:</p>
          <RetrievalCounts summary={retrieval} live />
        </>
      ) : (
        <>
          <p className="text-[13px] text-muted">
            {state === "understanding" ? "What Altostratus understood will appear here for you to check." : state === "drafting" ? "The draft will open here for you to edit. Nothing is sent." : "The shortlist will appear here."}
          </p>
          {state === "drafting" ? <SkeletonCard lines={6} /> : <SkeletonList count={3} />}
        </>
      )}
    </div>
  );
}
