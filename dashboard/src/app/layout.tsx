import type { Metadata } from "next";
import { Barlow_Semi_Condensed, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./features.css";
import { themeBootScript } from "@/components/ui/ThemeToggle";

// The Crust's own UI font is Bahnschrift (ships with Windows) and the terminal face is Cascadia Mono.
// These two only load as look-alike fallbacks for machines that don't have them.
const uiFallback = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-ui-fallback", display: "swap" });
const monoFallback = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-fallback", display: "swap" });

export const metadata: Metadata = {
  title: "CrustDash",
  description: "Director’s terminal for The Crust: live colony economy, market and alerts",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${uiFallback.variable} ${monoFallback.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
