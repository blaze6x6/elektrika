import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "@/lib/ThemeContext";
import { themeInitScript } from "@/lib/themes";

export const metadata: Metadata = {
  title: "Štrom poraba",
  description: "Beleženje porabe in proizvodnje energije",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icon"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Štrom",
  },
};

export const viewport = { themeColor: "#111827" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sl" data-theme="dark" data-mode="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="bg-gray-900 text-gray-100 antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
