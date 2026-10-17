"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { logout, setDemoToggle } from "../login/actions";

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
