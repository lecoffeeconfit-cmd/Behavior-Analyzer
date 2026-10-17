import type { Metadata } from "next";
import "@video-analyzer/ui/styles.css";

export const metadata: Metadata = {
  title: "Video Analyzer",
  description: "Private video intelligence. Inspect facial landmarks, movement, audio, captions, lighting and authenticity evidence locally, with optional Pro cloud insights.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
