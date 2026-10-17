import { ZONE_LABEL } from "@/lib/time";
import { Badge } from "../ui/badge";

/** "8 / 3" plus a status word. Never color alone: the word says over or at the limit. */
export function LoadCell({ load, max }: { load: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="font-mono text-[13px]">
        {load} / {max}
      </span>
      {load > max ? <Badge tone="danger">Over limit</Badge> : load === max && max > 0 ? <Badge tone="accent">At limit</Badge> : null}
    </span>
  );
}

export function ZoneText({ tz }: { tz: string }) {
  return <span title={tz}>{ZONE_LABEL[tz] ?? tz}</span>;
}

export const SOURCE_LABEL: Record<string, string> = {
  owns_service: "Owns service",
  project: "Project",
  authored_doc: "Wrote docs",
  team: "Team work",
  profile: "Profile only",
};

export function SourceBadge({ source }: { source: string }) {
  const tone = source === "owns_service" ? "accent" : "neutral";
  return <Badge tone={tone}>{SOURCE_LABEL[source] ?? source}</Badge>;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
