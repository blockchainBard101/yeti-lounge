import type { Metadata, Viewport } from "next";
import LayoutShell from "@/components/LayoutShell";
import EnokiWrapper from "@/components/EnokiWrapper";
import "./globals.css";

const boogaloo = { variable: "font-boogaloo" };
const kalam = { variable: "font-kalam" };
const plusJakarta = { variable: "font-plus-jakarta" };

export const metadata: Metadata = {
  title: "Yeti Lounge 🥶 — Lofi The Yeti Community Hub on Sui",
  description: "Thaw In. Hang Out. Build Together. The ultimate Web3 hangout on Sui.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${boogaloo.variable} ${kalam.variable} ${plusJakarta.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Boogaloo&family=Kalam:wght@400;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col bg-bg-primary text-text-primary">
        <EnokiWrapper>
          <LayoutShell>{children}</LayoutShell>
        </EnokiWrapper>
      </body>
    </html>
  );
}
