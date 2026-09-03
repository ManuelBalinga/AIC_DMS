import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// Archivo: a workhorse grotesk built for signage and forms rather than for
// display, which is what an Operate surface wants — and it holds tabular
// figures, which a ledger needs in every folio and date column.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "AIC Documents",
  description: "Internal document platform for the Accra Innovation Center.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
