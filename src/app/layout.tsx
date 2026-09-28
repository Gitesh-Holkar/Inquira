import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Inquira", template: "%s · Inquira" },
  description: "Lead management for B2B ingredient suppliers",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f7f8f6" }, { media: "(prefers-color-scheme: dark)", color: "#0e1310" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors closeButton position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
