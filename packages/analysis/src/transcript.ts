import type { TranscriptSegment } from "@video-analyzer/shared/types";

export function parseVtt(text: string): TranscriptSegment[] {
  const time = (value: string) => value.split(":").reduce((total, part) => total * 60 + Number(part.replace(",", ".")), 0);
  const segments: TranscriptSegment[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const index = lines.findIndex((line) => line.includes("-->"));
    if (index < 0) continue;
    const match = lines[index].match(/([\d:.]+)\s+-->\s+([\d:.]+)/);
    if (!match) continue;
    const start = time(match[1]), end = time(match[2]);
    const content = lines.slice(index + 1).join(" ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && content) segments.push({ start, end, text: content });
  }
  return segments.slice(0, 5000);
}

export async function extractTranscript(video: HTMLVideoElement): Promise<{ segments: TranscriptSegment[]; source: string }> {
  for (const track of Array.from(video.textTracks).slice(0, 3)) {
    if (!["captions", "subtitles"].includes(track.kind)) continue;
    const previous = track.mode;
    try {
      if (previous === "disabled") track.mode = "hidden";
      // Let Chrome load a public HTML track without altering visible captions.
      for (let attempt = 0; attempt < 12 && !track.cues?.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
      const segments = Array.from(track.cues || []).slice(0, 5000).map((cue) => ({ start: cue.startTime, end: cue.endTime, text: (cue as VTTCue).text?.replace(/<[^>]*>/g, "") || "" })).filter((cue) => cue.text.trim());
      if (segments.length) return { segments, source: `Page captions · ${track.label || track.language || "available track"}` };
    } finally { track.mode = previous; }
  }
  for (const track of Array.from(video.querySelectorAll("track[src]")).slice(0, 3)) {
    const element = track as HTMLTrackElement;
    if (!["captions", "subtitles"].includes(element.kind)) continue;
    try {
      const url = new URL(element.src, location.href);
      // Only public, same-origin track resources. No platform/private API scraping.
      if (url.origin !== location.origin) continue;
      const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(4000) });
      if (!response.ok || Number(response.headers.get("content-length")) > 2_000_000) continue;
      const text = await response.text();
      if (text.length > 2_000_000) continue;
      const segments = parseVtt(text);
      if (segments.length) return { segments, source: `Public caption track · ${element.label || element.srclang || "VTT"}` };
    } catch { /* Missing or restricted captions remain explicitly unavailable. */ }
  }
  return { segments: [], source: "No accessible caption track" };
}
