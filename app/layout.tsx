import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", weight: ["400", "500", "600", "700"] });
const body = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Ghostless — Stop applying to ghosts.",
  description:
    "Ghostless checks whether a job posting is real or a ghost job, finds people who can refer you, and tracks your follow-ups.",
};

export const viewport: Viewport = {
  themeColor: "#020305",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
