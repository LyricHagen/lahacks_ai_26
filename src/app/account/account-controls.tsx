"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { deleteAccount, logout, setDemoToggle } from "../login/actions";

const log = createLogger("account");

export function DemoToggle({ demoOn }: { demoOn: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function flip() {
    setBusy(true);
    log.info(`demo toggle clicked, turning it ${demoOn ? "off" : "on"}`);
    try {
      await runAction("mode.toggle", setDemoToggle, { demo: !demoOn });
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("demo toggle failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not change mode", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button onClick={flip} disabled={busy}>
      {demoOn ? "Turn demo mode off" : "Use demo mode"}
    </Button>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await runAction("auth.logout", logout, undefined);
      router.push(r.to);
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("logout failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not log out", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
      setBusy(false);
    }
  }
  return (
    <Button onClick={run} disabled={busy}>
      {busy ? "Logging out..." : "Log out"}
    </Button>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    log.info("delete account confirmed");
    try {
      const r = await runAction("auth.delete_account", deleteAccount, { confirm: typed.trim().toLowerCase() });
      router.push(r.to);
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("delete account failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Account not deleted", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Dialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        title="Delete your account?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={run} disabled={busy || typed.trim().toLowerCase() !== "delete"}>
              {busy ? "Deleting..." : "Delete everything"}
            </Button>
          </>
        }
      >
        <p className="text-sm">This removes your account, profile, asks, drafts, ramp plans, dismissals and usage records. It cannot be undone.</p>
        <label htmlFor="confirm-delete" className="mt-4 block text-sm font-medium">
          Type delete to confirm
        </label>
        <Input id="confirm-delete" className="mt-1.5" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </Dialog>
    </>
  );
}
