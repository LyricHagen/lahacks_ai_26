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
     * "not_approved", "user_budget", "global_budget", "no_api_key", or "provider_error".
     */
    outcome: text("outcome").notNull().default("live"),
    /** Error code when the provider call failed (MODEL_CALL_FAILED, ...). */
    errorCode: text("error_code"),
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

// ---------------------------------------------------------------------------
// asks
// ---------------------------------------------------------------------------

export const askStatusEnum = pgEnum("ask_status", ["draft", "ranked", "drafted", "sent", "resolved", "cancelled"]);
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
    status: askStatusEnum("status").notNull().default("draft"),
    source: askSourceEnum("source").notNull().default("user"),
    /** The colleague the ask ended up with. Counts toward their weekly ask load. */
    routedToId: text("routed_to_id").references(() => employees.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("asks_routed_idx").on(t.routedToId, t.createdAt), index("asks_user_idx").on(t.userId, t.createdAt)],
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
    rank: smallint("rank").notNull(),
    score: real("score").notNull(),
    /** Full score breakdown (every signal, weight and penalty) so a bad ranking can be debugged from SQL. */
    breakdown: jsonb("breakdown").notNull(),
    explanation: text("explanation"),
    chosen: boolean("chosen").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.askId, t.employeeId] })],
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
    /** slack or email. The human sends it; we only store the draft. */
    channel: text("channel").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: askMessageStatusEnum("status").notNull().default("draft"),
    slotStart: timestamp("slot_start", { withTimezone: true }),
    slotEnd: timestamp("slot_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ask_messages_ask_idx").on(t.askId)],
);

export const askEvents = pgTable(
  "ask_events",
  {
    id: serial("id").primaryKey(),
    askId: text("ask_id")
      .notNull()
      .references(() => asks.id, { onDelete: "cascade" }),
    /** created, ranked, drafted, copied, marked_sent, resolved, cancelled, ... */
    kind: text("kind").notNull(),
    data: jsonb("data"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ask_events_ask_idx").on(t.askId, t.at)],
);
