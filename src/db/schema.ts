// Drizzle schema. Edit here, then `pnpm db:generate` and `pnpm db:migrate`.
// pgvector is enabled by the first migration (drizzle/0000_enable_pgvector.sql).
//
// IDs are prefixed text ("emp_104", "svc_billing", "ask_12") because they are shown to users in
// mono and pasted into logs. Seeded rows get ids from the generator; rows created by the app
// (asks, users) take the next value of a sequence, starting above the seeded range.
//
// Tables group into four areas:
//   company   orgs, employees, skills, employee_skills, services, projects, project_members,
//             documents, calendar_events, mentorships (all rebuilt by the seed)
//   asks      asks, ask_candidates, ask_messages, ask_events (seeded history plus real asks)
//   accounts  users, usage_log, rate_limits (survive a reseed; never touched by it)
//   meta      app_meta (seed string, last seed summary, planted scenarios)

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

// Relative import: drizzle-kit loads this file without the @/ path alias.
import { EMBEDDING_DIMS } from "../lib/embed";

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

/** Key/value facts about the database itself (seed string, last seed summary, scenarios). */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// company
// ---------------------------------------------------------------------------

export const seniorityEnum = pgEnum("seniority", ["junior", "mid", "senior", "staff", "principal", "manager", "director", "executive"]);

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  description: text("description").notNull(),
  seed: text("seed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title").notNull(),
    department: text("department").notNull(),
    team: text("team").notNull(),
    seniority: seniorityEnum("seniority").notNull(),
    /** IANA zone, one of three: America/Los_Angeles, America/New_York, Europe/London. */
    timezone: text("timezone").notNull(),
    startDate: date("start_date").notNull(),
    managerId: text("manager_id").references((): AnyPgColumn => employees.id, { onDelete: "set null" }),
    slackHandle: text("slack_handle").notNull(),
    email: text("email").notNull(),
    bio: text("bio").notNull(),
    isMentor: boolean("is_mentor").notNull().default(false),
    maxWeeklyAsks: smallint("max_weekly_asks").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMS }),
  },
  (t) => [
    index("employees_manager_idx").on(t.managerId),
    index("employees_team_idx").on(t.team),
    uniqueIndex("employees_email_idx").on(t.email),
    index("employees_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Broad grouping for filters: language, platform, domain, practice, business. */
  category: text("category").notNull(),
  /** Other words people use for it ("k8s" for Kubernetes). Retrieval can match on these. */
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
});

/** Where we learned that someone has a skill. Ranking weighs these differently. */
export const skillSourceEnum = pgEnum("skill_source", ["owns_service", "project", "authored_doc", "team", "profile"]);

export const employeeSkills = pgTable(
  "employee_skills",
  {
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    proficiency: smallint("proficiency").notNull(),
    source: skillSourceEnum("source").notNull(),
    /** A full sentence shown to users: why we believe this person has the skill. */
    evidence: text("evidence").notNull(),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.skillId] }), index("employee_skills_skill_idx").on(t.skillId)],
);

export const services = pgTable(
  "services",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    repo: text("repo").notNull(),
    description: text("description").notNull(),
    team: text("team").notNull(),
    primaryOwnerId: text("primary_owner_id")
      .notNull()
      .references(() => employees.id),
    secondaryOwnerId: text("secondary_owner_id")
      .notNull()
      .references(() => employees.id),
    /** Skill ids this service exercises, so a question about the skill can reach the owners. */
    skillIds: text("skill_ids").array().notNull().default(sql`'{}'::text[]`),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMS }),
  },
  (t) => [index("services_primary_idx").on(t.primaryOwnerId), index("services_secondary_idx").on(t.secondaryOwnerId)],
);

export const projectStatusEnum = pgEnum("project_status", ["active", "finished"]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  team: text("team").notNull(),
  serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
  status: projectStatusEnum("status").notNull(),
  startedOn: date("started_on").notNull(),
  endedOn: date("ended_on"),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** lead, contributor, reviewer or advisor. */
    role: text("role").notNull(),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.employeeId] }), index("project_members_employee_idx").on(t.employeeId)],
);

export const documentKindEnum = pgEnum("document_kind", ["onboarding", "runbook", "how_to", "reference"]);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    kind: documentKindEnum("kind").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => employees.id),
    serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    updatedOn: date("updated_on").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMS }),
  },
  (t) => [index("documents_service_idx").on(t.serviceId), index("documents_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

export const calendarKindEnum = pgEnum("calendar_kind", ["meeting", "one_on_one", "standup", "focus", "interview", "office_hours", "ooo"]);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: serial("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: calendarKindEnum("kind").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** False for blocks that are open to interruptions (office hours). */
    busy: boolean("busy").notNull(),
  },
  (t) => [index("calendar_events_employee_start_idx").on(t.employeeId, t.startsAt)],
);

export const mentorships = pgTable(
  "mentorships",
  {
    id: serial("id").primaryKey(),
    mentorId: text("mentor_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    menteeId: text("mentee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    focus: text("focus").notNull(),
    startedOn: date("started_on").notNull(),
    /** Null while the mentorship is active. */
    endedOn: date("ended_on"),
  },
  (t) => [index("mentorships_mentor_idx").on(t.mentorId), index("mentorships_mentee_idx").on(t.menteeId)],
);

// ---------------------------------------------------------------------------
// accounts (declared before asks, which reference users)
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["pending", "approved", "rejected"]);
export const userIdSeq = pgSequence("user_id_seq", { startWith: 1 });

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .default(sql`'usr_' || nextval('user_id_seq')`),
    /** Stored lowercased and trimmed. */
    email: text("email").notNull().unique(),
    /** bcrypt hash. The password itself is never stored or logged (promise in /privacy). */
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("user"),
    status: userStatusEnum("status").notNull().default("pending"),
    /** Why this account is an admin: "first_account" or "admin_emails". Null for normal users. */
    adminReason: text("admin_reason"),
    /** The persona this account plays inside the synthetic company. Cleared if a reseed removes it. */
    employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: text("rejected_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    /** The shared guided demo account (src/lib/demo.ts). Always demo mode, never a model call. */
    isDemo: boolean("is_demo").notNull().default(false),
  },
  // One account per persona, so two people never act as the same colleague.
  (t) => [uniqueIndex("users_employee_idx").on(t.employeeId).where(sql`${t.employeeId} is not null`)],
);

export const usageLog = pgTable(
  "usage_log",
  {
    id: serial("id").primaryKey(),
    /** Deleting an account deletes its usage rows (promise in /privacy). */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    /** True when the caller got the committed demo fixture instead of a live result. */
    demo: boolean("demo").notNull().default(false),
    /** The mode resolveMode chose for the request: live or demo. */
    mode: text("mode").notNull().default("demo"),
    /**
     * What happened: "live" (model answered), or the first gate check that failed: "mode_demo",
     * "not_approved", "rate_limited", "user_budget", "global_budget", "no_api_key", or "provider_error".
     */
    outcome: text("outcome").notNull().default("live"),
    /** Error code when the provider call failed (MODEL_CALL_FAILED, ...). */
    errorCode: text("error_code"),
    /** Who answered: anthropic, veri, or fixture (a demo result). */
    provider: text("provider"),
    /** Which link of the purpose's chain served it: finetune, base, frontier, recorded, deterministic. */
    tier: text("tier"),
    /** Why that tier: earlier tiers skipped or failed, with codes and times. */
    tierNote: text("tier_note"),
    /** Plain text, not a foreign key, so spend history survives a reseed that removes asks. */
    askId: text("ask_id"),
    reqId: text("req_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_log_user_idx").on(t.userId, t.createdAt), index("usage_log_created_idx").on(t.createdAt)],
);

/**
 * Fixed-window counters for per-IP rate limits (signup, login). In Postgres, not memory, so the
 * limit holds across serverless instances. Key looks like "login:203.0.113.7".
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});

export const contactChannelEnum = pgEnum("contact_channel", ["slack", "email", "call"]);

/**
 * What a new hire told us in /onboarding. One row per account, written step by step; skipping
 * fills the defaults (see src/lib/onboarding.ts). Deleted with the account (promise in /privacy).
 */
export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Skill ids the new hire does not need explained. Ranking and the ramp plan read this. */
  knownSkillIds: text("known_skill_ids").array().notNull().default(sql`'{}'::text[]`),
  /** What they are working on first, in their own words. */
  firstFocus: text("first_focus").notNull().default(""),
  preferredChannel: contactChannelEnum("preferred_channel").notNull().default("slack"),
  /** False means: prefer peers and async messages before interrupting someone senior. */
  okToInterruptSeniors: boolean("ok_to_interrupt_seniors").notNull().default(false),
  roleConfirmedAt: timestamp("role_confirmed_at", { withTimezone: true }),
  contextAt: timestamp("context_at", { withTimezone: true }),
  channelsAt: timestamp("channels_at", { withTimezone: true }),
  /** Set when the last step is saved, or when the user skips the rest. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** True when any step was skipped and defaults were used for it. */
  usedDefaults: boolean("used_defaults").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// asks
// ---------------------------------------------------------------------------

/**
 * The ask lifecycle. The order and the allowed transitions live in src/lib/ask-state.ts; keep this
 * list identical to ASK_STATES there. Every change goes through transitionAsk, never a bare update.
 */
export const askStateEnum = pgEnum("ask_state", ["draft", "understanding", "confirming", "retrieving", "ranking", "shortlist", "drafting", "ready", "sent", "answered", "stale", "abandoned"]);
/** blocked_now prefers a quick call or a direct ping; curious prefers an asynchronous message. */
export const askUrgencyEnum = pgEnum("ask_urgency", ["blocked_now", "blocked_today", "curious"]);
export const askSourceEnum = pgEnum("ask_source", ["seed", "user", "demo"]);
/** Seeded asks use ids below 1000; asks created in the app start at ask_1000. */
export const askIdSeq = pgSequence("ask_id_seq", { startWith: 1000 });

export const asks = pgTable(
  "asks",
  {
    id: text("id")
      .primaryKey()
      .default(sql`'ask_' || nextval('ask_id_seq')`),
    /** The account that asked. Null for seeded history. Deleting the account deletes its asks. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** The persona inside the synthetic company who is asking. */
    askerEmployeeId: text("asker_employee_id").references(() => employees.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** What the asker already tried; goes into the draft. */
    tried: text("tried"),
    urgency: askUrgencyEnum("urgency").notNull().default("blocked_today"),
    /** What must stay out of the draft. Never logged (redacted by key name) and never sent to a model. */
    confidential: text("confidential"),
    status: askStateEnum("status").notNull().default("draft"),
    source: askSourceEnum("source").notNull().default("user"),
    /**
     * Signed-out visitors own their asks through the httpOnly w2a_visitor cookie, so the dashboard
     * can list them. Null for asks made by an account.
     */
    visitorId: text("visitor_id"),
    /**
     * What the understanding step found, after the user's corrections: restatement, services,
     * skills, artifacts, kind of help, sensitive spans. Shape: Understanding in src/lib/understanding.ts.
     */
    understanding: jsonb("understanding"),
    /** Per retrieval path: query, rows, people, ms; written as each path finishes so the page can show counts live. */
    retrieval: jsonb("retrieval"),
    /**
     * What ranking decided, beyond the per-candidate rows: top id and time (the 24 hour cooldown
     * reads these), guardrail reports, the why-not line, how the reasons were written. Shape:
     * RankingSummary in src/lib/ask-rank-step.ts.
     */
    ranking: jsonb("ranking"),
    /** The ask embedded with the same local model as the company (src/lib/embed.ts). */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMS }),
    /** Live status line for the processing states ("searching 200 people"), polled by /ask/[askId]. */
    progress: text("progress"),
    progressAt: timestamp("progress_at", { withTimezone: true }),
    /** Set while a request is running the pipeline, so two tabs never run it twice. */
    runLeaseUntil: timestamp("run_lease_until", { withTimezone: true }),
    /** Code of the last failed processing step (shown on the ask page with its request id). */
    lastErrorCode: text("last_error_code"),
    lastErrorReqId: text("last_error_req_id"),
    /** The colleague the ask ended up with. Counts toward their weekly ask load. */
    routedToId: text("routed_to_id").references(() => employees.id, { onDelete: "cascade" }),
    /**
     * What the drafting step used and decided: the scrubbed input payload, the recipient, the
     * suggested variant and format, the grounding check per variant, how the text was written.
     * Shape: DraftSummary in src/lib/ask-draft-step.ts.
     */
    draft: jsonb("draft"),
    /** When the asker said "I sent this" (wall time), and the app time at that moment (for the follow-up horizon). */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentAppAt: timestamp("sent_app_at", { withTimezone: true }),
    /** person (a colleague replied) or document (a doc answered it at the confirm step). Feeds /insights. */
    answeredVia: text("answered_via"),
    /** The one line the asker wrote about the answer, optional. Feeds /insights. */
    answerNote: text("answer_note"),
    answeredById: text("answered_by_id").references(() => employees.id, { onDelete: "set null" }),
    answeredDocId: text("answered_doc_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("asks_routed_idx").on(t.routedToId, t.createdAt), index("asks_user_idx").on(t.userId, t.createdAt), index("asks_visitor_idx").on(t.visitorId, t.createdAt)],
);

export const askCandidates = pgTable(
  "ask_candidates",
  {
    askId: text("ask_id")
      .notNull()
      .references(() => asks.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Shortlist position (1 is the top suggestion); null for people ranking did not shortlist. */
    rank: smallint("rank"),
    score: real("score"),
    /**
     * After ranking: { stage: "ranked", features (raw 0..1 and detail per component), contributions,
     * score, relevance, excluded, flags, reasonSource }. The shortlist re-ranks from features on the
     * client, so a bad ranking can be rebuilt from SQL alone.
     */
    breakdown: jsonb("breakdown").notNull().default(sql`'{}'::jsonb`),
    /** Retrieval paths that brought this person in (ownership, history, skill, semantic, authorship). */
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    /** Evidence items {kind, detail, source, recencyDays}; detail is a sentence a person would say. */
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    explanation: text("explanation"),
    chosen: boolean("chosen").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.askId, t.employeeId] })],
);

/**
 * Documents offered before searching people ("the best ask is the one nobody has to answer"), and
 * what the asker said about each. verdict null means not judged yet; not_answered is the signal
 * the insights page uses to find docs that fail new hires.
 */
export const askDocChecks = pgTable(
  "ask_doc_checks",
  {
    askId: text("ask_id")
      .notNull()
      .references(() => asks.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    rank: smallint("rank").notNull(),
    score: real("score").notNull(),
    /** The paragraph quoted on screen. */
    section: text("section").notNull(),
    /** Why the doc matched, as a sentence ("about billing-service, shares the words stripe, webhook"). */
    why: text("why").notNull(),
    /** answered or not_answered; null until the asker says. */
    verdict: text("verdict"),
    verdictAt: timestamp("verdict_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.askId, t.documentId] }), index("ask_doc_checks_doc_idx").on(t.documentId, t.verdict)],
);

export const askMessageStatusEnum = pgEnum("ask_message_status", ["draft", "copied", "marked_sent"]);

export const askMessages = pgTable(
  "ask_messages",
  {
    id: serial("id").primaryKey(),
    askId: text("ask_id")
      .notNull()
      .references(() => asks.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** slack, email or invite: the format shown. The human sends it; we only store the draft. */
    channel: text("channel").notNull(),
    /** short, full or call (src/lib/draft.ts). One row per variant. */
    variant: text("variant").notNull().default("short"),
    subject: text("subject"),
    body: text("body").notNull(),
    /** What the drafting step wrote, before the asker's edits. */
    originalSubject: text("original_subject"),
    originalBody: text("original_body"),
    /** live (model), demo (committed fixture) or template (no result, built from the input). */
    source: text("source").notNull().default("template"),
    status: askMessageStatusEnum("status").notNull().default("draft"),
    slotStart: timestamp("slot_start", { withTimezone: true }),
    slotEnd: timestamp("slot_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ask_messages_ask_idx").on(t.askId), uniqueIndex("ask_messages_variant_idx").on(t.askId, t.variant)],
);

export const askEvents = pgTable(
  "ask_events",
  {
    id: serial("id").primaryKey(),
    askId: text("ask_id")
      .notNull()
      .references(() => asks.id, { onDelete: "cascade" }),
    /** "transition" for every state change (written by transitionAsk); other kinds (copied, ...) are notes. */
    kind: text("kind").notNull().default("transition"),
    /** Null for the row that creates the ask. */
    fromState: askStateEnum("from_state"),
    toState: askStateEnum("to_state"),
    /** user or system. */
    actor: text("actor").notNull().default("system"),
    /** usr_N when a signed-in user acted, visitor for a signed-out one, null for the system. */
    actorId: text("actor_id"),
    reason: text("reason").notNull().default(""),
    reqId: text("req_id"),
    data: jsonb("data"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ask_events_ask_idx").on(t.askId, t.at)],
);

// ---------------------------------------------------------------------------
// ramp plan (prompt 9)
// ---------------------------------------------------------------------------

/**
 * One weekly ramp plan per owner (an account, or a signed-out visitor) per week. Built once per
 * week from the owner's ask history and the seeded company (one ramp_plan model call), and built
 * again only when that history changes (signature). Shape of plan: RampPlan in src/lib/ramp-types.ts.
 * Rebuilt by the seed (it points at seeded rows).
 */
export const rampPlans = pgTable(
  "ramp_plans",
  {
    id: serial("id").primaryKey(),
    /** usr_N or vis_... : whose plan this is. */
    owner: text("owner").notNull(),
    /** Deleting the account deletes its plans (promise in /privacy). */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id"),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Monday of the plan's week, in the asker's zone, in app time. */
    weekStart: date("week_start").notNull(),
    /** Hash of the inputs (asks, dismissals, profile). A different signature means rebuild. */
    signature: text("signature").notNull(),
    /** ready, or not_enough_history (the honest empty state). */
    status: text("status").notNull(),
    /** live (model), demo (committed fixture) or template (no result). */
    source: text("source").notNull(),
    plan: jsonb("plan").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ramp_plans_owner_week_idx").on(t.owner, t.weekStart)],
);

/** An item the owner dismissed. Later plans leave the row out and lower the skill it was for. */
export const rampDismissals = pgTable(
  "ramp_dismissals",
  {
    id: serial("id").primaryKey(),
    owner: text("owner").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id"),
    /** learn, stretch or meet. */
    section: text("section").notNull(),
    /** The row the item pointed at: doc_..., emp_..., prj_... */
    refId: text("ref_id").notNull(),
    /** The skill gap the item was for, if any. */
    skillId: text("skill_id"),
    /** The plan week it was dismissed from. */
    weekStart: date("week_start").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ramp_dismissals_owner_ref_idx").on(t.owner, t.refId)],
);
