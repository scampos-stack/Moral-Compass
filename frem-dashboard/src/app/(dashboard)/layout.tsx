import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";
import { Freshness } from "@/components/freshness";
import { Topbar } from "@/components/topbar";
import { isUnlocked } from "@/lib/edit-gate";
import { currentUser } from "@/lib/session";

/**
 * Chrome for signed-in pages. Everything under (dashboard) gets the sidebar,
 * header and data-age banner; /login sits outside the group and gets none.
 * The group name is in parentheses, so it does not appear in any URL.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [unlocked, user] = await Promise.all([isUnlocked(), currentUser()]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* useSearchParams needs a Suspense boundary during prerender. */}
      <Suspense fallback={<div className="w-full md:w-56" />}>
        <Sidebar />
      </Suspense>
      <div className="min-w-0 flex-1">
        <Topbar unlocked={unlocked} email={user?.email} />
        <Suspense fallback={null}>
          <Freshness />
        </Suspense>
        {children}
      </div>
    </div>
  );
}
