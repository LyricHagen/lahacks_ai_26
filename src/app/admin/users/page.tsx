import Link from "next/link";
import { Container, PageHeader } from "@/components/page-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { type AdminUserRow, adminEmails, listUsersForAdmin } from "@/lib/accounts";
import { requireAdmin } from "@/lib/auth";
import { toAppError } from "@/lib/errors";
import { createLogger, currentReqId } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { UserDecision } from "./user-decision";

export const metadata = { title: "Accounts" };

const log = createLogger("page.admin.users");

const STATUS_TONE: Record<AdminUserRow["status"], BadgeTone> = { pending: "accent", approved: "success", rejected: "danger" };

const ts = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "");

export default async function Page() {
  return withPage("admin.users", async () => {
    const admin = await requireAdmin("view /admin/users");
    const header = (
      <PageHeader
        eyebrow="/admin/users"
        title="Accounts"
        description="Approve accounts for live model calls. Pending and rejected accounts can browse everything in demo mode. The first account and any address in ADMIN_EMAILS become admin automatically."
      />
    );
    let rows: AdminUserRow[];
    try {
      rows = await listUsersForAdmin();
    } catch (err) {
      const e = toAppError(err);
      log.error("account list failed", { err, code: e.code });
      return (
        <Container>
          {header}
          <ErrorState title="Accounts could not be loaded" code={e.code} reqId={currentReqId()} body={e.message} />
        </Container>
      );
    }
    const pending = rows.filter((r) => r.status === "pending").length;
    const emails = new Map(rows.map((r) => [r.id, r.email]));
    log.info(`rendering ${rows.length} accounts, ${pending} pending`, { adminEmails: adminEmails().length });

    return (
      <Container>
        {header}
        <p className="mb-3 text-sm text-muted">
          <span className="font-mono text-fg">{rows.length}</span> accounts, <span className="font-mono text-fg">{pending}</span> pending.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No accounts yet" body="The first account to sign up becomes the admin." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Account</TH>
                <TH>Status</TH>
                <TH>Persona</TH>
                <TH>Signed up (UTC)</TH>
                <TH className="text-right">Tokens</TH>
                <TH className="text-right">Cost USD</TH>
                <TH>Decision</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="min-w-[14rem]">
                    <div className="break-all">{r.email}</div>
                    <div className="font-mono text-[12px] text-subtle">
                      {r.id}
                      {r.role === "admin" ? ` admin${r.adminReason ? ` (${r.adminReason.replace("_", " ")})` : ""}` : ""}
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    {r.approvedBy ? <div className="mt-1 text-[12px] text-subtle">by {emails.get(r.approvedBy) ?? r.approvedBy}</div> : null}
                    {r.rejectedBy ? <div className="mt-1 text-[12px] text-subtle">by {emails.get(r.rejectedBy) ?? r.rejectedBy}</div> : null}
                  </TD>
                  <TD>
                    {r.employeeId ? (
                      <>
                        <Link href={`/directory/${r.employeeId}`} className="whitespace-nowrap">
                          {r.personaName ?? r.employeeId}
                        </Link>
                        <div className="text-[12px] text-subtle">{r.personaTeam}</div>
                      </>
                    ) : (
                      <span className="text-subtle">none</span>
                    )}
                  </TD>
                  <TD mono className="whitespace-nowrap">
                    {ts(r.createdAt)}
                    {r.lastLoginAt ? <div className="text-[12px] text-subtle">last in {ts(r.lastLoginAt)}</div> : null}
                  </TD>
                  <TD mono className="text-right">
                    {r.tokens}
                    <div className="text-[12px] text-subtle">{r.calls} calls</div>
                  </TD>
                  <TD mono className="text-right">
                    {r.costUsd.toFixed(4)}
                  </TD>
                  <TD>
                    <UserDecision userId={r.id} email={r.email} status={r.status} isSelf={r.id === admin.id} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Container>
    );
  });
}
