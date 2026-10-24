import type { Metadata, Viewport } from "next";
import { themeInitScript } from "@/components/theme-toggle";
import "./theme.css";
import "./globals.css";
import "./app.css";

export const metadata: Metadata = {
  title: {
    default: "DataPilot — Your data, ready for decisions",
    template: "%s · DataPilot",
  },
  description:
    "A secure workspace for data quality, analysis, repairs, and machine-learning readiness.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2fa" },
    { media: "(prefers-color-scheme: dark)", color: "#060b18" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The init script sets data-theme before hydration, so React must not warn about it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
