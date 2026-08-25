import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Freshness } from "@/components/freshness";
import { Topbar } from "@/components/topbar";
import { themeScript } from "@/components/theme-toggle";
import { isUnlocked } from "@/lib/edit-gate";
import { currentUser } from "@/lib/session";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Frém — Moral Compass",
  description: "Wholesale outreach and revenue for Frém",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [unlocked, user] = await Promise.all([isUnlocked(), currentUser()]);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the saved theme before first paint, so a dark-mode user
            never sees a white flash on load. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
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
      </body>
    </html>
  );
}
