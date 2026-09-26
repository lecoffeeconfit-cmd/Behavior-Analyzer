import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Behavior Analyzer",
  description: "See behavioral changes across face, eyes, voice, movement, and speech.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
