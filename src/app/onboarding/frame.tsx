import Link from "next/link";
import type { ReactNode } from "react";
import { Container, PageHeader } from "@/components/page-header";
import { cn } from "@/components/ui/cn";
import type { SessionUser } from "@/lib/auth";
import { ONBOARDING_STEPS, type OnboardingStep, type Profile, STEP_LABEL, stepDone } from "@/lib/onboarding";
import { SkipControls } from "./forms";

/** Shared chrome for the three steps: step links (each its own URL), a pending note, skip controls. */
export function OnboardingFrame({ step, user, profile, title, description, children }: { step: OnboardingStep; user: SessionUser; profile: Profile | null; title: string; description: string; children: ReactNode }) {
  const idx = ONBOARDING_STEPS.indexOf(step);
  return (
    <Container className="max-w-3xl">
      <PageHeader eyebrow={`/onboarding/${step}`} title={title} description={description} />
      <ol className="mb-8 grid grid-cols-3 border border-line bg-raised" aria-label="Onboarding steps">
        {ONBOARDING_STEPS.map((s, i) => {
          const done = stepDone(profile, s);
          const current = s === step;
          return (
            <li key={s} className={cn("border-r border-line last:border-r-0", current && "bg-accent-soft border-b-2 border-b-accent")}>
              <Link href={`/onboarding/${s}`} aria-current={current ? "step" : undefined} className={cn("block px-3 py-2 text-[13px] no-underline", current ? "font-semibold text-fg" : done ? "text-fg" : "text-muted")}>
                <span className="block font-mono text-[11px] text-muted">
                  {i + 1} of 3 {done ? "done" : current ? "now" : ""}
                </span>
                {STEP_LABEL[s]}
              </Link>
            </li>
          );
        })}
      </ol>
      {user.status === "pending" && idx === 0 ? (
        <p className="mb-6 border border-line bg-sunken px-4 py-3 text-sm">
          Your account is waiting for approval. Until then everything works in demo mode. <Link href="/pending">What this means</Link>
        </p>
      ) : null}
      {children}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[13px] text-muted">Every step is optional. Skipped steps use defaults from your persona, and you can come back to any step by its link.</p>
        <SkipControls step={step} />
      </div>
    </Container>
  );
}
