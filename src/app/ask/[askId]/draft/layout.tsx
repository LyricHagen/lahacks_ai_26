import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LiveStatus } from "@/components/ask/live-status";
import { type DraftClientData, DraftFlushOnNavigate, DraftProvider } from "@/components/draft/draft-workspace";
import { GroundingReport } from "@/components/draft/grounding-report";
import { Container, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { getDraftView } from "@/lib/ask-review";
import { type AskDetail, getAskDetail } from "@/lib/asks";
import { loadThisWeek } from "@/lib/availability";
import { getClock } from "@/lib/clock-request";
import { DRAFT_VARIANTS, VARIANT_DEF } from "@/lib/draft";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { getSessionUser } from "@/lib/auth";
import { getPhoneView, latestDelivery, maskHandle } from "@/lib/phone";
import { withPage } from "@/lib/request-context";
import { eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";

const log = createLogger("page.ask.draft");

/** The phone option (FEATURE_PHOTON) for the ask's signed-in owner; null for anyone else or when off. */
async function phoneFor(askId: string, ownerId: string | null): Promise<DraftClientData["phone"]> {
  const user = await getSessionUser();
  if (!user || !ownerId || user.id !== ownerId || user.isDemo) {
    log.skip(`${askId} phone option`, !user ? "signed out (texting needs your own account)" : user.isDemo ? "shared demo account" : "viewer is not the ask's owner");
    return null;
  }
  const v = await getPhoneView(user);
  if (!v.enabled || !v.configured) return null;
  const d = v.status === "linked" ? await latestDelivery(user.id, askId) : null;
  return { linked: v.status === "linked", handle: v.status === "linked" ? maskHandle(v.handle ?? "") : null, lastDelivery: d ? { status: d.status, at: d.at } : null };
}

/**
 * /ask/[askId]/draft/{short,full,call}: one URL per variant, all under this layout, which holds
 * the editor state so switching tabs keeps every edit.
 */
export default async function DraftLayout({ children, params }: { children: ReactNode; params: Promise<{ askId: string }> }) {
  const { askId } = await params;
  return withPage("ask.draft", async () => {
    let d: AskDetail;
    try {
      d = await getAskDetail(askId);
    } catch (err) {
      if (err instanceof AppError && err.code === "ASK_NOT_FOUND") {
        log.branch("render 404", `${askId} not found or not visible to this viewer`, { askId });
        notFound();
      }
      throw err;
    }
    const { ask } = d;
    const view = await getDraftView(ask.id, ask.draft);
    const back = (
      <ButtonLink href={`/ask/${ask.id}`} size="sm">
        Back to the ask
      </ButtonLink>
    );

    if (!view || ask.status === "drafting") {
      log.branch(`${ask.id} draft page without a draft`, `ask is in ${ask.status}${view ? " (being redrafted)" : ""}`, { askId: ask.id });
      return (
        <Container className="max-w-4xl">
          <PageHeader eyebrow={`/ask/${ask.id}/draft`} title="Draft message" actions={back} />
          {ask.status === "drafting" ? (
            <LiveStatus askId={ask.id} initialState={ask.status} initialProgress={ask.progress} canRun={d.canAct} />
          ) : (
            <EmptyState
              title="No draft yet"
              body="A draft is written once you pick someone from the shortlist."
              action={
                <ButtonLink href={`/ask/${ask.id}`} size="sm" variant="primary">
                  Go to the ask
                </ButtonLink>
              }
            />
          )}
        </Container>
      );
    }

    const s = view.summary;
    const clock = await getClock();
    const [count, maxRow] = await Promise.all([
      loadThisWeek(s.recipient.id, clock.now),
      q("draft.recipient.max", (db) => db.select({ max: t.employees.maxWeeklyAsks }).from(t.employees).where(eq(t.employees.id, s.recipient.id)).limit(1)),
    ]);
    const readOnly = ask.status !== "ready" || !d.canAct;
    const readOnlyReason =
      ask.status === "sent" || ask.status === "stale" || ask.status === "answered"
        ? `You marked this sent${s.sent ? ` as ${VARIANT_DEF[s.sent.variant].label}` : ""}. Follow it up on the ask page.`
        : !d.canAct
          ? "Seeded history is read only."
          : `This ask is in ${ask.status}, so this draft is no longer the one in use.`;
    const data: DraftClientData = {
      askId: ask.id,
      readOnly,
      readOnlyReason,
      asker: { name: ask.askerName ?? "You" },
      recipient: { id: s.recipient.id, name: s.recipient.name, firstName: s.recipient.firstName, slackHandle: s.recipient.slackHandle, email: s.recipient.email },
      suggested: { variant: s.suggested.variant, format: s.suggested.format },
      sentVariant: s.sent?.variant ?? null,
      slotLabel: s.input.slot?.label ?? null,
      load: maxRow[0] ? { count, max: maxRow[0].max } : null,
      texts: Object.fromEntries(DRAFT_VARIANTS.map((v) => [v, { subject: view.messages[v].subject, body: view.messages[v].body }])) as DraftClientData["texts"],
      originals: Object.fromEntries(DRAFT_VARIANTS.map((v) => [v, { subject: view.messages[v].originalSubject, body: view.messages[v].originalBody }])) as DraftClientData["originals"],
      format: s.sent?.format ?? view.messages[s.suggested.variant].format,
      phone: await phoneFor(ask.id, ask.userId),
    };
    log.info(`${ask.id} draft page for ${s.recipient.id} in state ${ask.status}${readOnly ? " (read only)" : ""}: suggested ${s.suggested.variant}/${s.suggested.format}, via=${s.via}, load ${count}/${data.load?.max ?? "?"}`, { askId: ask.id });

    const tabs = DRAFT_VARIANTS.map((v) => ({
      href: `/ask/${ask.id}/draft/${v}`,
      label: `${VARIANT_DEF[v].label}${v === s.sent?.variant ? " (sent)" : v === s.suggested.variant && !s.sent ? " (suggested)" : ""}`,
    }));

    return (
      <Container className="max-w-4xl">
        <PageHeader
          eyebrow={`/ask/${ask.id}/draft`}
          title={`Message to ${s.recipient.name}`}
          description={
            <>
              {s.input.relationship.sentence} <Link href={`/directory/${s.recipient.id}`}>See their profile</Link>.
            </>
          }
          actions={back}
        />
        <DraftProvider data={data}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
            <div className="grid gap-3">
              <p className="text-sm">
                <span className="font-semibold">Suggested: {VARIANT_DEF[s.suggested.variant].label}.</span> {s.suggested.why}
              </p>
              {s.recommendationTarget ? (
                <p className="text-[13px] text-muted">
                  The shortlist suggested asking <Link href={`/directory/${s.recommendationTarget.id}`}>{s.recommendationTarget.name}</Link> instead. You chose {s.recipient.firstName}, so the draft is for {s.recipient.firstName}.
                </p>
              ) : null}
              {s.note ? <p className="font-mono text-[12px] text-muted">{s.note}</p> : null}
            </div>
            <DraftFlushOnNavigate>
              <Tabs label="Draft versions" items={tabs} />
            </DraftFlushOnNavigate>
            <section aria-label="Draft">{children}</section>

            <Card>
              <CardHeader title={`Why ${s.recipient.firstName}`} meta="What the draft may say about them comes only from this" />
              <CardBody className="grid gap-2 text-sm">
                {s.input.why.reason ? <p>{s.input.why.reason}</p> : null}
                <ul className="grid gap-1 text-[13px] text-muted">
                  {s.input.why.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <GroundingReport summary={s} />
          </div>
        </DraftProvider>
      </Container>
    );
  });
}
