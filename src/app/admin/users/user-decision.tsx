"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { approveUser, rejectUser } from "./actions";

const log = createLogger("admin.users");

export function UserDecision({ userId, email, status, isSelf }: { userId: string; email: string; status: string; isSelf: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);

  async function decide(to: "approved" | "rejected") {
    setConfirmReject(false);
    setBusy(true);
    log.info(`${to === "approved" ? "approve" : "reject"} clicked`, { userId });
    try {
      const r = await runAction(`admin.users.${to === "approved" ? "approve" : "reject"}`, to === "approved" ? approveUser : rejectUser, { userId });
      toast.show({ kind: "success", title: `${r.email} ${to}` });
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("decision failed", { err, code: e?.code, userId });
      toast.show({ kind: "error", title: "Decision failed", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      {status !== "approved" ? (
        <Button size="sm" variant="primary" disabled={busy} onClick={() => decide("approved")}>
          Approve
        </Button>
      ) : null}
      {status !== "rejected" && !isSelf ? (
        <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmReject(true)}>
          Reject
        </Button>
      ) : null}
      <Dialog
        open={confirmReject}
        onClose={() => setConfirmReject(false)}
        title="Reject this account?"
        footer={
          <>
            <Button onClick={() => setConfirmReject(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => decide("rejected")}>
              Reject
            </Button>
          </>
        }
      >
        <p>
          <span className="font-mono">{email}</span> will stay in demo mode and see a plain &quot;not approved&quot; message. You can approve it later.
        </p>
      </Dialog>
    </div>
  );
}
