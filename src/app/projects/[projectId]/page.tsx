import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getProject } from "@/lib/library";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { formatDay } from "@/lib/time";

const log = createLogger("page.project");

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return { title: projectId };
}

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  return withPage("projects.detail", async () => {
    const { projectId } = await params;
    const data = await getProject(projectId);
    if (!data) {
      log.branch("render 404", `no project with id ${projectId}`, { code: "NOT_FOUND" });
      notFound();
    }
    const { project: p, members } = data;
    log.info(`project ${p.id} rendered with ${members.length} members`);
    return (
      <Container className="max-w-4xl">
        <PageHeader
          eyebrow={`/projects/${p.id}`}
          title={p.name}
          description={
            <>
              {p.team} team, {p.status === "active" ? "active" : "finished"} since {formatDay(p.startedOn)}
              {p.endedOn ? ` until ${formatDay(p.endedOn)}` : ""}
              {p.serviceName ? (
                <>
                  , on <span className="font-mono">{p.serviceName}</span>
                </>
              ) : null}
            </>
          }
          actions={<Badge tone={p.status === "active" ? "accent" : "neutral"}>{p.status === "active" ? "Active" : "Finished"}</Badge>}
        />
        <p className="mb-8 max-w-[65ch] text-[15px]">{p.description}</p>
        <h2 className="mb-3 text-lg font-semibold">
          People <span className="font-mono text-[12px] text-muted">{members.length}</span>
        </h2>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Team</TH>
              <TH>Since</TH>
            </TR>
          </THead>
          <TBody>
            {members.map((m) => (
              <TR key={m.id}>
                <TD>
                  <Link href={`/directory/${m.id}`}>{m.name}</Link>
                  <span className="block text-[12px] text-muted">{m.title}</span>
                </TD>
                <TD>{m.role}</TD>
                <TD>{m.team}</TD>
                <TD className="font-mono text-[12px]">
                  {m.startedOn}
                  {m.endedOn ? ` to ${m.endedOn}` : ""}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Container>
    );
  });
}
