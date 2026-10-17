export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "Live";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
