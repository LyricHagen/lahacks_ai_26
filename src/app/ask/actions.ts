"use server";

import {
  abandonAskAction,
  backToShortlistAction,
  chooseCandidateAction,
  confirmAskAction,
  copyDraftAction,
  createAskAction,
  markAnsweredAction,
  markSentAction,
  retryAskAction,
  saveDraftAction,
  tryNextAction,
} from "@/lib/ask-actions";
import type { DraftFormat, DraftVariant } from "@/lib/draft";
import { deliverDraftAction } from "@/lib/phone-actions";
import type { ConfirmInput } from "@/lib/understanding";
import type { NewAskInput } from "@/lib/asks";

// "use server" files may only export async functions, so the wrapped actions live in src/lib/ask-actions.ts.
export async function createAsk(input: NewAskInput) {
  return createAskAction(input);
}
export async function abandonAsk(input: { askId: string }) {
  return abandonAskAction(input);
}
export async function retryAsk(input: { askId: string }) {
  return retryAskAction(input);
}
export async function confirmAsk(input: ConfirmInput) {
  return confirmAskAction(input);
}
export async function chooseCandidate(input: { askId: string; employeeId: string; tune?: number; shownRank?: number }) {
  return chooseCandidateAction(input);
}

type DraftFields = { askId: string; variant: DraftVariant; format: DraftFormat; subject: string; body: string };
export async function saveDraft(input: DraftFields) {
  return saveDraftAction(input);
}
export async function copyDraft(input: DraftFields) {
  return copyDraftAction(input);
}
export async function markSent(input: DraftFields) {
  return markSentAction(input);
}
export async function markAnswered(input: { askId: string; note?: string }) {
  return markAnsweredAction(input);
}
export async function tryNext(input: { askId: string; employeeId: string }) {
  return tryNextAction(input);
}
export async function backToShortlist(input: { askId: string }) {
  return backToShortlistAction(input);
}
export async function deliverDraft(input: DraftFields) {
  return deliverDraftAction(input);
}
