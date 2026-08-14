import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Tabs } from "@/components/tabs";

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
      <body className="min-h-full flex flex-col">
        <header className="flex items-end justify-between px-8 pt-6">
          <div>
            <p className="wordmark text-xs text-muted">Frém</p>
            <p className="text-lg">Moral Compass</p>
          </div>
        </header>
        <Tabs />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
