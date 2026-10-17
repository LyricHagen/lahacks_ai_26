// Templated text for the seed: bios, document bodies and mentorship focus lines.
// Used when no model key is present, and always for anything that must match the structure
// exactly (skill evidence, planted documents). Templates avoid pronouns on purpose.

import type { Zone } from "@/lib/time";
import type { Rng } from "./rng";

const CITIES: Record<Zone, string[]> = {
  "America/Los_Angeles": ["San Francisco", "Oakland", "Los Angeles", "Seattle", "Portland", "San Diego"],
  "America/New_York": ["New York", "Boston", "Atlanta", "Toronto", "Philadelphia", "Miami"],
  "Europe/London": ["London", "Manchester", "Dublin", "Bristol", "Edinburgh"],
};

const INTERESTS = [
  "Outside work: trail running and very long podcasts.",
  "Plays in a weekend football league.",
  "Bakes sourdough and brings the results to the office.",
  "Restores old film cameras.",
  "Coaches a youth chess club on Saturdays.",
  "Is slowly learning Portuguese.",
  "Rides a bike to work in every season.",
  "Grows far too many tomatoes every summer.",
  "Volunteers at a local food bank.",
  "Collects vinyl, mostly jazz.",
  "Climbs at the bouldering gym twice a week.",
  "Writes short fiction that nobody is allowed to read.",
  "Keeps a very opinionated list of the best tacos in town.",
  "Swims in open water whenever the weather allows.",
  "Builds mechanical keyboards.",
];

const FOCUS_BY_TRACK: Record<string, string[]> = {
  swe: ["Spends most days in service code and code review.", "Cares a lot about tests that fail for the right reason.", "Likes small pull requests and fast reviews."],
  mobile: ["Splits time between the iOS and Android apps.", "Watches crash reports closely after every release."],
  sre: ["Spends most days on clusters, pipelines and alerts.", "Prefers boring infrastructure that never pages anyone."],
  data: ["Spends most days in pipelines and warehouse models.", "Likes data that arrives on time and adds up."],
  ml: ["Works on ranking models and the evaluation sets behind them.", "Runs offline evaluations before anything ships."],
  analyst: ["Turns product questions into SQL and dashboards.", "Keeps KPI definitions consistent across teams."],
  security: ["Reviews designs for security problems before they ship.", "Runs threat modeling sessions for new features."],
  pm: ["Writes the specs and talks to shippers every week.", "Owns the roadmap for a slice of the product."],
  design: ["Designs flows in Figma and tests them with shippers.", "Keeps the design system consistent across web and mobile."],
  research: ["Runs interviews and usability tests with shippers.", "Turns research into decisions the team can act on."],
  support: ["Handles technical escalations from enterprise shippers.", "Reproduces customer bugs and hands engineering a clean report."],
  csm: ["Looks after a book of enterprise shippers.", "Runs onboarding for new enterprise accounts."],
  it: ["Keeps laptops, accounts and the VPN working.", "Handles new hire laptop setup."],
  people: ["Runs onboarding and benefits questions for new hires.", "Partners with managers on hiring and team health."],
  finance: ["Handles expenses, corporate cards and month end close.", "Answers questions about budgets and spend."],
};

export function city(rng: Rng, tz: Zone): string {
  return rng.pick(CITIES[tz]);
}

export function tenurePhrase(startDay: number): string {
  const days = -startDay;
  if (days < 14) return "Joined Corvid this month.";
  if (days < 90) return `Joined Corvid ${Math.round(days / 7)} weeks ago.`;
  if (days < 365) return `Joined Corvid ${Math.round(days / 30)} months ago.`;
  const years = Math.round(days / 365);
  return `Has been at Corvid for ${years === 1 ? "about a year" : `${years} years`}.`;
}

export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function templateBio(
  rng: Rng,
  p: {
    first: string;
    title: string;
    team: string;
    track: string;
    tz: Zone;
    startDay: number;
    primaryOf: string[];
    secondaryOf: string[];
    topSkills: string[];
    hook?: string;
    isMentor: boolean;
    isLeader: boolean;
  },
): string {
  const parts: string[] = [];
  parts.push(`${p.first} is ${/^[AEIOU]/.test(p.title) ? "an" : "a"} ${p.title}${p.isLeader ? "" : ` on the ${p.team} team`}, based in ${city(rng, p.tz)}.`);
  parts.push(tenurePhrase(p.startDay));
  if (p.primaryOf.length) parts.push(`Primary owner of ${listPhrase(p.primaryOf)}.`);
  if (p.secondaryOf.length) parts.push(`Backs up ${listPhrase(p.secondaryOf)} as secondary owner.`);
  if (p.hook) parts.push(p.hook);
  else parts.push(rng.pick(FOCUS_BY_TRACK[p.track] ?? FOCUS_BY_TRACK.swe));
  if (p.topSkills.length) parts.push(`Day to day: ${listPhrase(p.topSkills)}.`);
  if (p.isMentor) parts.push("Mentors new hires and holds weekly office hours.");
  parts.push(rng.pick(INTERESTS));
  return parts.join(" ");
}

export const MENTOR_FOCUS = [
  "Getting productive in the team's codebase",
  "Preparing for a first on-call shadow week",
  "Shipping a first project end to end",
  "Learning the freight and billing domain",
  "Writing design docs that get approved quickly",
  "Navigating the org and finding the right people",
  "Code review habits and giving feedback",
  "Moving from junior to mid level",
  "Running effective customer calls",
  "Planning and estimating work",
];

export function serviceOverviewBody(p: { name: string; repo: string; description: string; team: string; teamKey: string; primary: string; secondary: string; skills: string[] }): string {
  return [
    `${p.name} (${p.repo}): ${p.description}`,
    `Owners: ${p.primary} is the primary owner and ${p.secondary} is the secondary owner. The ${p.team} team reviews every change.`,
    "Getting started",
    `1. Clone ${p.repo} and run \`make dev\`. The README lists the environment variables you need; secrets come from the vault, never from a teammate's file.`,
    "2. Read docs/ARCHITECTURE.md in the repo. It explains the main data flow in one page.",
    `3. Ask in #team-${p.teamKey.replace(/_/g, "-")} before changing anything that touches production data.`,
    "What you need to know",
    `Most work here involves ${listPhrase(p.skills)}. Changes ship behind a feature flag and deploy through build-pipeline.`,
    `Questions that are not answered here: ask the secondary owner first, then the primary owner.`,
  ].join("\n\n");
}

export function serviceRunbookBody(p: { name: string; repo: string; team: string; teamKey: string }): string {
  return [
    `Runbook for ${p.name}. Use it when an alert fires or a deploy goes wrong.`,
    "Dashboards",
    `The ${p.name} overview dashboard shows request rate, error rate and latency. Error rate above 1 percent for five minutes pages the on-call engineer.`,
    "Deploy and roll back",
    `Deploy with \`corvid deploy ${p.name}\`. Roll back with \`corvid deploy ${p.name} --previous\`; it takes about two minutes.`,
    "Common alerts",
    `High error rate: check the most recent deploy first. If it started right after a deploy, roll back before debugging.`,
    `High latency: check the database panel. Slow queries usually come from a missing index on a new column.`,
    "Escalation",
    `Page the ${p.team} on-call rotation through the incident bot with \`/page ${p.teamKey.replace(/_/g, "-")}\`.`,
  ].join("\n\n");
}

export const GENERAL_BODIES: Record<string, string> = {
  doc_first_week: [
    "Welcome to Corvid. Your first week is about access, people and one small win.",
    "Day 1: pick up your laptop, finish the onboarding portal checklist and meet your buddy.",
    "Day 2: set up your development environment (see Setting up your laptop and VPN) and read your team's service overviews.",
    "Day 3 to 5: pair with your buddy on a small change and ship it behind a flag.",
    "Your manager schedules a 30 minute check-in on day 5. Bring questions; nobody expects you to know how things work yet.",
  ].join("\n\n"),
  doc_laptop_setup: [
    "Your laptop arrives enrolled in device management. Sign in with your Corvid account and wait for the setup profile to finish (about 20 minutes).",
    "VPN: install the client from the self service app and sign in with SSO. It reconnects automatically; if it drops every hour, update the client from self service.",
    "Developer tools are installed by `corvid setup`. Run it once after the profile finishes.",
    "Lost or broken laptop: file a ticket with IT. Do not wipe it yourself.",
  ].join("\n\n"),
  doc_eng_onboarding: [
    "From laptop to first deploy in four steps.",
    "1. Run `corvid setup`, then clone your team's main repo.",
    "2. Every repo has `make dev` and `make test`. If either fails on a clean checkout, that is a bug: tell the owning team.",
    "3. Open a small pull request. Two approvals are required for services marked tier one.",
    "4. Merging to main deploys to staging automatically. Production deploys run through build-pipeline with `corvid deploy <service>`.",
    "Each service lists its primary and secondary owner in the service catalog. Ask them, not the whole channel.",
  ].join("\n\n"),
  doc_pto_policy: [
    "Corvid has flexible time off with a recommended minimum of 15 days a year, plus local public holidays.",
    "Put time off on your calendar as Out of office so teammates and tools can see it. Tell your manager at least two weeks ahead for anything longer than three days.",
    "New hires can take time off from their first month.",
  ].join("\n\n"),
  doc_incident_basics: [
    "If something is broken in production, open an incident with `/incident new` in chat. The bot pages the owning rotation.",
    "You will not get in trouble for opening an incident that turns out to be minor.",
    "The incident channel is the single place for updates. Write what you see, not what you think caused it.",
  ].join("\n\n"),
};
