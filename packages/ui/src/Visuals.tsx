import type { ReactNode } from "react";
import type { FaceSample, PoseSample } from "@video-analyzer/shared/types";

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    scan: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="4"/><path d="M12 8v8m-4-4h8"/></>,
    history: <><path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/></>,
    play: <path d="m8 4 12 8-12 8Z"/>,
    shield: <><path d="m12 3 8 3v5c0 5-5 9-8 10-3-1-8-5-8-10V6Z"/><path d="m8 12 3 3 5-6"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    audio: <><path d="M4 9v6m4-10v14m4-17v20m4-17v14m4-10v6"/></>,
    spark: <><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/></>,
    file: <><path d="M14 2H5v20h14V7Zm0 0v5h5M8 12h8m-8 4h6"/></>,
    close: <path d="m5 5 14 14M5 19 19 5"/>,
    check: <path d="m4 12 5 5L20 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.scan}</svg>;
}

export function Chart({ values, label, unit = "", color = "#88baff", times = [] }: { values: Array<number | null>; label: string; unit?: string; color?: string; times?: number[] }) {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!finite.length) return <div className="chart-empty">No measured {label.toLowerCase()} data</div>;
  const min = Math.min(...finite), max = Math.max(...finite), span = Math.max(0.001, max - min);
  const path = values.map((v, i) => {
    if (v === null || !Number.isFinite(v)) return "";
    const previous = values[i - 1];
    const command = i > 0 && previous !== null && Number.isFinite(previous) ? "L" : "M";
    return `${command}${(i / Math.max(1, values.length - 1) * 280 + 4).toFixed(1)},${(70 - (v - min) / span * 56).toFixed(1)}`;
  }).join(" ");
  return <div className="chart"><div className="chart-top"><span>{label}</span><small>{min.toFixed(2)}–{max.toFixed(2)} {unit}</small></div><svg viewBox="0 0 288 80" preserveAspectRatio="none" role="img" aria-label={`${label}: minimum ${min.toFixed(2)}, maximum ${max.toFixed(2)} ${unit}`}><path d="M0 14H288M0 42H288M0 70H288" className="chart-grid"/><path d={path} stroke={color} strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke"/>{finite.length === 1 && <circle cx="4" cy="70" r="3" fill={color}/>}</svg><div className="chart-axis"><span>{times.length ? `${times[0].toFixed(1)}s` : "First sample"}</span><span>{times.length ? `${times.at(-1)!.toFixed(1)}s` : "Last sample"}</span></div></div>;
}

const faceEdges = [[33, 133], [159, 145], [362, 263], [386, 374], [70, 105], [105, 107], [300, 334], [334, 336], [61, 13], [13, 291], [291, 14], [14, 61], [10, 1], [1, 152], [234, 1], [1, 454]];
const bodyEdges = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28]];
export function LandmarkOverlay({ faces, poses }: { faces: FaceSample[]; poses: PoseSample[] }) {
  return <svg className="landmark-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Measured face and body landmarks over the selected sampled frame">
    {poses.map((pose) => <g key={pose.slot} stroke="#b4a7ff" strokeWidth="0.45" fill="#b4a7ff">{bodyEdges.filter(([a, b]) => (pose.points[a].visibility || 0) > 0.5 && (pose.points[b].visibility || 0) > 0.5).map(([a, b]) => <line key={`${a}-${b}`} x1={pose.points[a].x * 100} y1={pose.points[a].y * 100} x2={pose.points[b].x * 100} y2={pose.points[b].y * 100}/>)}{pose.points.filter((p) => (p.visibility || 0) > 0.5).map((p, i) => <circle key={i} cx={p.x * 100} cy={p.y * 100} r="0.6" stroke="none"/>)}</g>)}
    {faces.map((face) => <g key={face.slot} stroke="#88baff" fill="#88baff" strokeWidth="0.35">{faceEdges.map(([a, b]) => <line key={`${a}-${b}`} x1={face.points[a].x * 100} y1={face.points[a].y * 100} x2={face.points[b].x * 100} y2={face.points[b].y * 100}/>)}{face.points.filter((_, i) => i % 7 === 0).map((p, i) => <circle key={i} cx={p.x * 100} cy={p.y * 100} r="0.25" stroke="none"/>)}</g>)}
  </svg>;
}

export function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}
