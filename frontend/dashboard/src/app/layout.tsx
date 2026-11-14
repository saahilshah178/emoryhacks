import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/layout/Providers";
import { APP_NAME } from "@/lib/branding";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: `Clinical Dashboard · ${APP_NAME}`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "AI-assisted caregiver skills verification for home-care agencies. Nurses review demonstrations and give final approval.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-page font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[12px] focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
