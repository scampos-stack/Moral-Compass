import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Freshness } from "@/components/freshness";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col md:flex-row">
          {/* useSearchParams needs a Suspense boundary during prerender. */}
          <Suspense fallback={<div className="w-full md:w-56" />}>
            <Sidebar />
          </Suspense>
          <div className="min-w-0 flex-1">
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
