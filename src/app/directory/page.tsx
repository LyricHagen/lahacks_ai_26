import Link from "next/link";
import { formatDate, LoadCell, ZoneText } from "@/components/directory/bits";
import { Container, PageHeader } from "@/components/page-header";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { directoryFacets, type DirectoryFilters, LOAD_WINDOW_DAYS, listEmployees, PAGE_SIZE, parseFilters } from "@/lib/directory";
import { toAppError } from "@/lib/errors";
import { getClock } from "@/lib/clock-request";
import { createLogger, currentReqId } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { ZONE_LABEL, ZONES } from "@/lib/time";

export const metadata = { title: "Directory" };

const log = createLogger("page.directory");

function hrefWith(f: DirectoryFilters, patch: Partial<DirectoryFilters>): string {
  const next = { ...f, ...patch };
  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  if (next.department) sp.set("department", next.department);
  if (next.team) sp.set("team", next.team);
  if (next.timezone) sp.set("timezone", next.timezone);
  if (next.mentor) sp.set("mentor", next.mentor);
  if (next.sort !== "name") sp.set("sort", next.sort);
  if (next.page > 1) sp.set("page", String(next.page));
  const s = sp.toString();
  return s ? `/directory?${s}` : "/directory";
}

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return withPage("directory", async () => {
    const f = parseFilters(await searchParams);
    const header = (
      <PageHeader
        eyebrow="/directory"
        title="Directory"
        description="Everyone at Ferndale Systems, the synthetic company the app ranks against. Search by name, title, team, skill or service."
      />
    );

    let data: Awaited<ReturnType<typeof listEmployees>>;
    let facets: Awaited<ReturnType<typeof directoryFacets>>;
    try {
      [data, facets] = await Promise.all([listEmployees(f, (await getClock()).now), directoryFacets()]);
    } catch (err) {
      const e = toAppError(err);
      log.error("directory failed to load", { err, code: e.code });
      return (
        <Container>
          {header}
          <ErrorState title="The directory could not be loaded" code={e.code} reqId={currentReqId()} body={e.message} />
        </Container>
      );
    }

    if (facets.totalEmployees === 0) {
      log.branch("render empty company state", "employees table is empty");
      return (
        <Container>
          {header}
          <EmptyState
            title="No synthetic company yet"
            body={
              <>
                The database has no employees. Run <code className="font-mono">pnpm db:reset</code> or reseed from the admin page. Code{" "}
                <span className="font-mono">SEED_EMPTY</span>.
              </>
            }
            action={<ButtonLink href="/admin/seed">Open seed admin</ButtonLink>}
          />
        </Container>
      );
    }

    const teams = f.department ? facets.teams.filter((t) => t.department === f.department) : facets.teams;
    const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    const filtered = !!(f.q || f.department || f.team || f.timezone || f.mentor);
    log.info(`rendering ${data.rows.length} of ${data.total} employees`, { page: f.page, pages, filtered });

    return (
      <Container>
        {header}

        <form method="get" action="/directory" className="mb-6 grid gap-3 border border-line bg-raised p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
          <Field label="Search" htmlFor="q">
            <Input id="q" name="q" defaultValue={f.q} placeholder="Name, skill, service" />
          </Field>
          <Field label="Department" htmlFor="department">
            <Select id="department" name="department" defaultValue={f.department}>
              <option value="">All</option>
              {facets.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Team" htmlFor="team">
            <Select id="team" name="team" defaultValue={f.team}>
              <option value="">All</option>
              {teams.map((t) => (
                <option key={`${t.department}/${t.team}`} value={t.team}>
                  {t.team} ({t.n})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timezone" htmlFor="timezone">
            <Select id="timezone" name="timezone" defaultValue={f.timezone}>
              <option value="">All</option>
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  {ZONE_LABEL[z]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mentors" htmlFor="mentor">
            <Select id="mentor" name="mentor" defaultValue={f.mentor}>
              <option value="">Everyone</option>
              <option value="yes">Mentors only</option>
            </Select>
          </Field>
          <Field label="Sort" htmlFor="sort">
            <Select id="sort" name="sort" defaultValue={f.sort}>
              <option value="name">Name</option>
              <option value="load">Ask load</option>
              <option value="newest">Newest</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("primary")}>
              Apply
            </button>
            {filtered ? (
              <Link href="/directory" className={buttonClass("ghost", "md", "no-underline")}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <p className="mb-3 text-sm text-muted" aria-live="polite">
          <span className="font-mono text-fg">{data.total}</span> {data.total === 1 ? "person" : "people"}
          {filtered ? " match" : ""}. Ask load counts asks routed to each person in the last {LOAD_WINDOW_DAYS} days against their weekly limit.
        </p>

        {data.rows.length === 0 ? (
          <EmptyState
            title="Nobody matches"
            body="Try a skill name (Kafka), a service (billing-service) or clear the filters."
            action={<ButtonLink href="/directory">Clear filters</ButtonLink>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Title</TH>
                <TH>Team</TH>
                <TH>Time</TH>
                <TH className="text-right">Owns</TH>
                <TH>Ask load</TH>
                <TH>Started</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/directory/${r.id}`} className="font-medium">
                      {r.name}
                    </Link>
                    <div className="font-mono text-[12px] text-subtle">
                      {r.id}
                      {r.isMentor ? <span className="ml-2 font-sans text-muted">mentor</span> : null}
                    </div>
                  </TD>
                  <TD className="min-w-[12rem]">{r.title}</TD>
                  <TD className="whitespace-nowrap">
                    {r.team}
                    <div className="text-[12px] text-subtle">{r.department}</div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <ZoneText tz={r.timezone} />
                  </TD>
                  <TD mono className="text-right">
                    {r.owns || <span className="text-subtle">0</span>}
                  </TD>
                  <TD>
                    <LoadCell load={r.load} max={r.maxWeeklyAsks} />
                  </TD>
                  <TD mono className="whitespace-nowrap">
                    {formatDate(r.startDate)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {pages > 1 ? (
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-4 text-sm">
            {f.page > 1 ? <Link href={hrefWith(f, { page: f.page - 1 })}>Previous page</Link> : <span className="text-subtle">Previous page</span>}
            <span className="font-mono text-[13px] text-muted">
              page {f.page} of {pages}
            </span>
            {f.page < pages ? <Link href={hrefWith(f, { page: f.page + 1 })}>Next page</Link> : <span className="text-subtle">Next page</span>}
          </nav>
        ) : null}
      </Container>
    );
  });
}
