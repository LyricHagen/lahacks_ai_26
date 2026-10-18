"use client";
// A draft shown read only, laid out where it would be sent (Slack DM, email or invite). The guided
// demo shows all three variants side by side; editing happens on the real draft page.

import { MessageMock, type MockPeople } from "@/components/draft/message-mock";
import type { DraftFormat } from "@/lib/draft";

export function ReadOnlyMock(p: MockPeople & { format: DraftFormat; subject: string; body: string; when: string | null; statusLabel: string }) {
  return <MessageMock {...p} readOnly onSubject={() => {}} onBody={() => {}} />;
}
