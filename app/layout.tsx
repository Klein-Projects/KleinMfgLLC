import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Klein Manufacturing, LLC — Handcrafted Aviation Scrapers",
  description:
    "Handcrafted phenolic aviation scrapers. Safe on aluminum, composites, and painted surfaces. Made in the USA.",
  openGraph: {
    title: "Klein Manufacturing, LLC — Handcrafted Aviation Scrapers",
    description:
      "Handcrafted phenolic aviation scrapers. Safe on aluminum, composites, and painted surfaces. Made in the USA.",
    url: "https://kleinmfgllc.com",
    siteName: "Klein Manufacturing, LLC",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Klein Manufacturing, LLC — Handcrafted Aviation Scrapers",
    description:
      "Handcrafted phenolic aviation scrapers. Safe on aluminum, composites, and painted surfaces. Made in the USA.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-offwhite text-charcoal antialiased`}>
        {children}
      </body>
    </html>
  );
}
