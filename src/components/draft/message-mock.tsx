"use client";
// The draft laid out the way it will look where the asker sends it: a Slack DM, an email, or a
// calendar invite. Plain bordered renderings, not brand replicas. Every text field is the editor
// itself, so what is on screen is exactly what Copy takes.

import type { ReactNode } from "react";
import { type DraftFormat, CALL_MINUTES } from "@/lib/draft";

export type MockPeople = {
  asker: { name: string };
  recipient: { name: string; slackHandle: string; email: string };
};

type Props = MockPeople & {
  format: DraftFormat;
  subject: string;
  body: string;
  /** "Mon, Oct 19, 11:00 Pacific" for the invite, or null when no slot was found. */
  when: string | null;
  readOnly: boolean;
  /** Draft or Sent: the label on the mock's header. */
  statusLabel: string;
  onSubject: (s: string) => void;
  onBody: (s: string) => void;
};

const field = "w-full bg-transparent text-fg focus-visible:outline-2 focus-visible:outline-offset-2 read-only:cursor-default";
// field-sizing grows the box with the text; rows is the fallback minimum.
const bodyField = `${field} resize-none leading-relaxed [field-sizing:content] min-h-[8rem]`;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2 border-b border-line px-4 py-2 text-sm">
      <span className="text-[13px] text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Header({ title, statusLabel }: { title: string; statusLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-sunken px-4 py-2">
      <p className="text-[13px] font-semibold">{title}</p>
      <span className="font-mono text-[11px] uppercase tracking-wide text-muted">{statusLabel}</span>
    </div>
  );
}

export function MessageMock(p: Props) {
  const lines = Math.max(6, p.body.split("\n").length + 2);
  const bodyEl = (
    <textarea
      aria-label="Message"
      value={p.body}
      readOnly={p.readOnly}
      rows={lines}
      onChange={(e) => p.onBody(e.target.value)}
      className={bodyField}
      spellCheck
    />
  );
  const subjectEl = (label: string) => (
    <input aria-label={label} value={p.subject} readOnly={p.readOnly} onChange={(e) => p.onSubject(e.target.value)} className={`${field} font-medium`} />
  );

  if (p.format === "slack") {
    return (
      <div className="border border-line-strong bg-raised" data-format="slack">
        <Header title={`Direct message to ${p.recipient.slackHandle}`} statusLabel={p.statusLabel} />
        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 px-4 py-3">
          <span aria-hidden className="flex h-9 w-9 items-center justify-center border border-line-strong bg-sunken font-mono text-[13px]">
            {p.asker.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="text-sm">
              <span className="font-semibold">{p.asker.name}</span> <span className="text-[12px] text-muted">you, to {p.recipient.name}</span>
            </p>
            <div className="mt-1 text-[15px]">{bodyEl}</div>
          </div>
        </div>
      </div>
    );
  }

  if (p.format === "email") {
    return (
      <div className="border border-line-strong bg-raised" data-format="email">
        <Header title="New email" statusLabel={p.statusLabel} />
        <Row label="To">
          <span className="font-mono text-[13px]">{p.recipient.email}</span> <span className="text-[13px] text-muted">({p.recipient.name})</span>
        </Row>
        <Row label="From">
          <span>{p.asker.name}</span> <span className="text-[13px] text-muted">(you)</span>
        </Row>
        <Row label="Subject">{subjectEl("Subject")}</Row>
        <div className="px-4 py-3 text-[15px]">{bodyEl}</div>
      </div>
    );
  }

  return (
    <div className="border border-line-strong bg-raised" data-format="invite">
      <Header title="New calendar invite" statusLabel={p.statusLabel} />
      <Row label="Title">{subjectEl("Invite title")}</Row>
      <Row label="When">
        {p.when ? (
          <span>
            {p.when}, {CALL_MINUTES} min
          </span>
        ) : (
          <span className="text-muted">No open {CALL_MINUTES} minutes found in the next 14 days: pick a time in your calendar</span>
        )}
      </Row>
      <Row label="Guests">
        <span>{p.recipient.name}</span> <span className="font-mono text-[13px] text-muted">{p.recipient.email}</span>
      </Row>
      <Row label="Organizer">
        <span>{p.asker.name}</span> <span className="text-[13px] text-muted">(you)</span>
      </Row>
      <div className="px-4 py-3">
        <p className="mb-1 text-[13px] text-muted">Description</p>
        <div className="text-[15px]">{bodyEl}</div>
      </div>
    </div>
  );
}
