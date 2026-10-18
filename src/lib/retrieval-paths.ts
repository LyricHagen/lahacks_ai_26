// Names, labels and shapes of the retrieval paths, with no server imports so the ask page's
// client components (live counts, candidate list) render from the same definitions the server
// writes. The paths themselves run in src/lib/retrieve.ts.

export const RETRIEVAL_PATHS = ["ownership", "history", "skill", "semantic", "authorship", "manager"] as const;
export type RetrievalPath = (typeof RETRIEVAL_PATHS)[number];

export const PATH_LABEL: Record<RetrievalPath, string> = {
  ownership: "Owns the service",
  history: "Worked on it",
  skill: "Has the skill",
  semantic: "Profile matches",
  authorship: "Wrote a related doc",
  manager: "Your manager, when nothing else matched",
};

export type EvidenceKind = "owner" | "project" | "answered" | "skill" | "profile" | "author" | "manager";
export type Evidence = { kind: EvidenceKind; path: RetrievalPath; detail: string; source: string; recencyDays: number | null };

export type Candidate = { employeeId: string; name: string; title: string; team: string; sources: RetrievalPath[]; evidence: Evidence[] };

export type PathSummary = { path: RetrievalPath; label: string; status: "done" | "skipped"; query: string; rows: number; people: number; ms: number; note?: string };

export type RetrievalSummary = { version: 1; paths: PathSummary[]; total: number | null; beforeCap: number | null; cut: string[]; at: string | null };

