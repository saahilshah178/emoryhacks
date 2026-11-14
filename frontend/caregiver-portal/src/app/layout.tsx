import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { APP_NAME, APP_TAGLINE } from "@/config/branding";
import { Providers } from "@/app/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_TAGLINE,
};

export const viewport: Viewport = {
  themeColor: "#17324D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full w-full bg-bg font-sans text-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
