import "server-only";
// Read model for /demo and /demo/[step]: the guided ask in every stage it went through (its stored
// understanding, doc checks, ranking and drafts all survive later states), the persona, and the
// owners of the guided service with their load at the pinned demo clock. The guided ask is shared
// demo data, so anyone may read it here; acting on it still needs the demo account.

import { eq, inArray } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { getPersonaSummary, type PersonaSummary } from "./accounts";
import { type DocCheckView, type DraftView, getDocChecks, getDraftView, getRanking, type RankingView } from "./ask-review";
import type { AskState, AskUrgency } from "./ask-state";
import { loadsThisWeek } from "./availability";
import { type AppClock } from "./clock";
import { demoClock } from "./clock-server";
import type { DemoState } from "./demo";
import { GUIDED_SERVICE } from "./demo-script";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { protectUnderstanding } from "./understand-build";
import { normalizeUnderstanding, type Understanding } from "./understanding";
import type { Viewer } from "./viewer";

const log = createLogger("demo.view");

const DAY_MS = 86_400_000;

export type OwnerView = { id: string; name: string; firstName: string; title: string; role: "primary" | "secondary"; load: number; max: number };

export type GuidedView = {
  askId: string;
  status: AskState;
  body: string;
  tried: string | null;
  urgency: AskUrgency;
  u: Understanding | null;
  docs: DocCheckView[];
  ranking: RankingView | null;
  draft: DraftView | null;
  persona: (PersonaSummary & { daysIn: number | null }) | null;
  service: { id: string; name: string; primary: OwnerView; secondary: OwnerView } | null;
  clock: AppClock;
};

export async function getGuidedView(state: DemoState, viewer: Viewer): Promise<GuidedView> {
  const askId = state.guidedAskId;
  const [ask] = await q("demo.view.ask", (db) =>
    db.select({ status: t.asks.status, body: t.asks.body, tried: t.asks.tried, urgency: t.asks.urgency, understanding: t.asks.understanding, ranking: t.asks.ranking, draft: t.asks.draft }).from(t.asks).where(eq(t.asks.id, askId)).limit(1),
  );
  if (!ask) throw new AppError("DEMO_NOT_READY", `guided ask ${askId} is missing; press Reset demo`, { status: 503 });
  log.debug(`auth decision: allow guided ${askId} for ${viewer.actorId} (shared demo data, readable by anyone; acting on it needs the demo account)`);
  const u = normalizeUnderstanding(ask.understanding);
  protectUnderstanding(u);
  // Always the pinned clock: the guided story is demo data even when an admin in live mode looks at it.
  const clock = await demoClock("guided demo page");
  const [docs, ranking, draft, persona, svc, start] = await Promise.all([
    getDocChecks(askId),
    getRanking(askId, ask.ranking),
    ask.draft ? getDraftView(askId, ask.draft) : Promise.resolve(null),
    getPersonaSummary(state.personaId),
    q("demo.view.service", (db) => db.select({ id: t.services.id, name: t.services.name, primary: t.services.primaryOwnerId, secondary: t.services.secondaryOwnerId }).from(t.services).where(eq(t.services.id, GUIDED_SERVICE)).limit(1)),
    q("demo.view.start", (db) => db.select({ start: t.employees.startDate }).from(t.employees).where(eq(t.employees.id, state.personaId)).limit(1)),
  ]);
  let service: GuidedView["service"] = null;
  if (svc[0]) {
    const ids = [svc[0].primary, svc[0].secondary];
    const [people, loads] = await Promise.all([
      q("demo.view.owners", (db) => db.select({ id: t.employees.id, name: t.employees.name, title: t.employees.title, max: t.employees.maxWeeklyAsks }).from(t.employees).where(inArray(t.employees.id, ids))),
      loadsThisWeek(ids, clock.now),
    ]);
    const owner = (id: string, role: OwnerView["role"]): OwnerView => {
      const p = people.find((x) => x.id === id);
      return { id, name: p?.name ?? id, firstName: (p?.name ?? id).split(" ")[0], title: p?.title ?? "", role, load: loads.get(id) ?? 0, max: p?.max ?? 0 };
    };
    service = { id: svc[0].id, name: svc[0].name, primary: owner(svc[0].primary, "primary"), secondary: owner(svc[0].secondary, "secondary") };
  } else {
    log.warn(`guided service ${GUIDED_SERVICE} is not in the loaded company`);
  }
  const startMs = start[0] ? Date.parse(`${start[0].start}T00:00:00Z`) : Number.NaN;
  const daysIn = Number.isFinite(startMs) ? Math.max(0, Math.floor((clock.now.getTime() - startMs) / DAY_MS)) : null;
  log.info(`guided view ${askId}: ${ask.status}, ${docs.length} docs, ${ranking?.people.length ?? 0} ranked, draft ${draft ? "yes" : "no"}; ${service ? `${service.primary.id} ${service.primary.load}/${service.primary.max}, ${service.secondary.id} ${service.secondary.load}/${service.secondary.max}` : "no service"}`);
  return { askId, status: ask.status, body: ask.body, tried: ask.tried, urgency: ask.urgency, u, docs, ranking, draft, persona: persona ? { ...persona, daysIn } : null, service, clock };
}
