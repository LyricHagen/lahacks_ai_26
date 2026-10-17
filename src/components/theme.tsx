"use client";

import { useEffect, useState } from "react";
import { createLogger } from "@/lib/client-log";
import { cn } from "./ui/cn";

export type ThemePref = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "w2a-theme";

const log = createLogger("ui.theme");

/**
 * Inline script for <head>. Runs before first paint so there is no flash of the wrong theme.
 * Keep it dependency free and in sync with applyTheme below.
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.dataset.theme=d?'dark':'light';r.dataset.themePref=p;}catch(e){document.documentElement.dataset.theme='light';}})();`;

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(pref: ThemePref) {
  const r = document.documentElement;
  r.dataset.theme = resolve(pref);
  r.dataset.themePref = pref;
}

function readPref(): ThemePref {
  const p = document.documentElement.dataset.themePref;
  return p === "light" || p === "dark" ? p : "system";
}

const OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeToggle({ className }: { className?: string }) {
  // null until mounted: the server cannot know the stored preference.
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => {
    const initial = readPref();
    setPref(initial);
    log.debug(`theme on load: ${initial}`, { resolved: document.documentElement.dataset.theme });
  }, []);

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
      log.info("system color scheme changed", { resolved: document.documentElement.dataset.theme });
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  function choose(next: ThemePref) {
    setPref(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (err) {
      log.warn("could not persist theme, storage blocked", { err });
    }
    log.info(`theme set to ${next}`, { resolved: document.documentElement.dataset.theme });
  }

  return (
    <div role="radiogroup" aria-label="Color theme" className={cn("inline-flex border border-line", className)}>
      {OPTIONS.map((o) => {
        const active = pref === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(o.value)}
            className={cn(
              "h-7 px-2 text-[12px] cursor-pointer border-r border-line last:border-r-0",
              active ? "bg-fg text-bg font-semibold" : "text-muted hover:text-fg hover:bg-sunken",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
