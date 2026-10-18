import "server-only";
// Read model for /docs/[docId] and /projects/[projectId]: one seeded document or project, so a
// ramp plan item or an insights row can link to the exact row it came from.

import { and, asc, eq, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { createLogger } from "./log";

const log = createLogger("library");

export async function getDocument(id: string) {
  const [doc] = await q("library.doc", (db) =>
    db
      .select({
        id: t.documents.id,
        title: t.documents.title,
        kind: t.documents.kind,
        body: t.documents.body,
        updatedOn: t.documents.updatedOn,
        authorId: t.employees.id,
        authorName: t.employees.name,
        authorTitle: t.employees.title,
        serviceId: t.services.id,
        serviceName: t.services.name,
        serviceRepo: t.services.repo,
      })
      .from(t.documents)
      .innerJoin(t.employees, eq(t.employees.id, t.documents.authorId))
      .leftJoin(t.services, eq(t.services.id, t.documents.serviceId))
      .where(eq(t.documents.id, id))
      .limit(1),
  );
  if (!doc) {
    log.info(`document ${id} not found`);
    return null;
  }
  // Aggregate verdicts only, the same k threshold as /insights is applied by the page.
  const [v] = await q("library.doc.verdicts", (db) =>
    db.execute<{ answered: number; failed: number }>(sql`
      select count(*) filter (where verdict = 'answered')::int as answered, count(*) filter (where verdict = 'not_answered')::int as failed
      from ask_doc_checks where document_id = ${id}`),
  );
  log.debug(`document ${id} loaded`, { verdicts: v });
  return { doc, verdicts: v ?? { answered: 0, failed: 0 } };
}

export async function getProject(id: string) {
  const [project] = await q("library.project", (db) =>
    db
      .select({ id: t.projects.id, name: t.projects.name, description: t.projects.description, team: t.projects.team, status: t.projects.status, startedOn: t.projects.startedOn, endedOn: t.projects.endedOn, serviceId: t.services.id, serviceName: t.services.name, serviceRepo: t.services.repo })
      .from(t.projects)
      .leftJoin(t.services, eq(t.services.id, t.projects.serviceId))
      .where(eq(t.projects.id, id))
      .limit(1),
  );
  if (!project) {
    log.info(`project ${id} not found`);
    return null;
  }
  const members = await q("library.project.members", (db) =>
    db
      .select({ id: t.employees.id, name: t.employees.name, title: t.employees.title, team: t.employees.team, role: t.projectMembers.role, startedOn: t.projectMembers.startedOn, endedOn: t.projectMembers.endedOn })
      .from(t.projectMembers)
      .innerJoin(t.employees, eq(t.employees.id, t.projectMembers.employeeId))
      .where(and(eq(t.projectMembers.projectId, id)))
      .orderBy(asc(t.projectMembers.role), asc(t.employees.name)),
  );
  log.debug(`project ${id} loaded with ${members.length} members`);
  return { project, members };
}
