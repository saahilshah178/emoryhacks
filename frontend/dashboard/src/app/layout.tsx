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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
