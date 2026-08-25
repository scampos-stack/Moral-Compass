import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { themeScript } from "@/components/theme-toggle";

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

/**
 * Document shell only. The sidebar, header and data banner live in the
 * (dashboard) group so signed-out pages like /login render bare — a nested
 * layout renders INSIDE its parent rather than replacing it, so chrome put
 * here would follow the login page no matter what.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
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
      {/* suppressHydrationWarning: password managers and other extensions
          add attributes to <body> before React hydrates. Harmless, but it
          logs a mismatch we cannot fix from here. */}
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
