import { Suspense } from "react";
import { Tabs } from "@/components/ui/tabs";

// Access is enforced in src/proxy.ts (and again by requireAdmin in each page and action).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-4 pt-6">
        <Suspense fallback={<div className="h-10 border-b border-line" />}>
          <Tabs
            label="Admin"
            items={[
              { href: "/admin/users", label: "Accounts" },
              { href: "/admin/usage", label: "Model usage" },
              { href: "/admin/seed", label: "Synthetic company" },
            ]}
          />
        </Suspense>
      </div>
      {children}
    </>
  );
}
