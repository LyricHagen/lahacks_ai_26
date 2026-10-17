import { Suspense } from "react";
import { DebugConsole } from "@/components/debug/debug-console";
import { Container, PageHeader } from "@/components/page-header";
import { SkeletonTable } from "@/components/ui/skeleton";

export const metadata = { title: "Debug log" };

export default function DebugPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="/debug"
        title="Debug log"
        description={
          <>
            Every client log line and every server line returned with an API response in this browser tab, newest last. The server ring buffer
            holds the last 500 server lines across all requests (development or admins only). Filter by a request id such as{" "}
            <code className="font-mono text-[13px]">req_8f3a1c</code> to follow one request.
          </>
        }
      />
      <Suspense fallback={<SkeletonTable rows={10} cols={1} />}>
        <DebugConsole />
      </Suspense>
    </Container>
  );
}
