"use client";

import { useEffect } from "react";
import { createLogger } from "@/lib/client-log";

const log = createLogger("page.not-found");

/** Next renders not-found.tsx ahead of time, so the 404 is logged here, only when it is shown. */
export function NotFoundLogger() {
  useEffect(() => {
    log.warn(`404 for ${window.location.pathname}`, { code: "NOT_FOUND", referrer: document.referrer || undefined });
  }, []);
  return null;
}
