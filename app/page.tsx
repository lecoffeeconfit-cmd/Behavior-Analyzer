"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisEvent, AnalysisResult, AnalysisSection, JobSnapshot } from "@/lib/types";

type SourceMode = "upload" | "url";
type DashboardTab = "overview" | "eyes" | "face" | "voice" | "body" | "transcript";

const stageSteps = ["Receiving video", "Reading media", "Extracting audio", "Detecting subject", "Analyzing face", "Analyzing eyes", "Analyzing body", "Analyzing voice", "Transcribing speech", "Calculating baseline", "Building timeline", "Preparing report", "Complete"];
const categories = ["All", "Eyes", "Face", "Voice", "Body", "Combined"] as const;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v4h16v-4" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l1-1a5 5 0 0 0-7-7l-.6.6" /><path d="M14 11a5 5 0 0 0-7.5-.5l-1 1a5 5 0 0 0 7 7l.6-.6" /></>,
    play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 5 4-5 4V8Z" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    shield: <><path d="M12 3 20 6v5c0 5-3.3 8.7-8 10-4.7-1.3-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatNumber(value: unknown, digits = 1): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toFixed(digits).replace(/\.0+$/, "");
}

function titleCase(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function eventCategory(category: AnalysisEvent["category"]): string {
  return category === "combined" ? "Combined" : category.charAt(0).toUpperCase() + category.slice(1);
}

function MiniChart({ section, color = "#82b8ff", label }: { section: AnalysisSection; color?: string; label: string }) {
  const points = section.series.slice(-90);
  const path = useMemo(() => {
    if (!points.length) return "";
    const values = points.map((point) => Number(point.value) || 0);
    const max = Math.max(...values, 0.1);
    const min = Math.min(...values, 0);
    const span = Math.max(0.1, max - min);
    return values.map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * 100;
      const y = 35 - ((value - min) / span) * 28;
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  }, [points]);
  return <div className="chart-wrap" aria-label={`${label} over time`}>
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="sparkline" role="img"><path d="M0 35H100M0 18H100" className="chart-grid" />{path && <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}</svg>
    {!points.length && <span className="chart-empty">No sampled data</span>}
  </div>;
}

function MetricCard({ label, value, hint, accent = "blue" }: { label: string; value: string; hint: string; accent?: string }) {
  return <div className={`metric-card metric-${accent}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-hint">{hint}</div></div>;
}

function EventRow({ event, onSeek }: { event: AnalysisEvent; onSeek: (time: number) => void }) {
  return <button className="event-row" onClick={() => onSeek(event.timestamp)}><span className={`event-dot dot-${event.category}`} /><span className="event-time">{formatTime(event.timestamp)}</span><span className="event-content"><span className="event-category">{eventCategory(event.category)}</span><span className="event-label">{event.label}</span><span className="event-detail">{event.detail || (event.differencePercent !== undefined ? `${formatNumber(Math.abs(event.differencePercent))}% compared with baseline` : event.duration ? `${formatNumber(event.duration)} seconds` : "Timestamped measurement")}</span></span><Icon name="chevron" size={16} /></button>;
}

function SectionPanel({ title, section, color, onSeek }: { title: string; section: AnalysisSection; color: string; onSeek: (time: number) => void }) {
  const entries = Object.entries(section.summary).filter(([, value]) => typeof value === "number" || typeof value === "string");
  return <div className="section-panel"><div className="section-panel-head"><div><span className="eyebrow">{title}</span><h3>Measured signals</h3></div><span className="signal-status"><span className="status-dot" /> local analysis</span></div><MiniChart section={section} color={color} label={title} /><div className="signal-grid">{entries.slice(0, 6).map(([key, value]) => <div className="signal-item" key={key}><span>{titleCase(key)}</span><strong>{formatNumber(value)}</strong></div>)}</div>{section.events.length > 0 && <div className="mini-events"><div className="mini-events-title">Timestamped events</div>{section.events.slice(0, 5).map((event, index) => <EventRow event={event} onSeek={onSeek} key={`${event.timestamp}-${index}`} />)}</div>}</div>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character));
}

function buildPrintableReport(result: AnalysisResult): string {
  const events = result.timeline.slice(0, 100).map((event) => `<tr><td>${formatTime(event.timestamp)}</td><td>${escapeHtml(eventCategory(event.category))}</td><td>${escapeHtml(event.label)}</td><td>${escapeHtml(event.detail || "—")}</td></tr>`).join("");
  const transcript = result.transcript.map((segment) => `<tr><td>${formatTime(segment.start)}</td><td>${formatTime(segment.end)}</td><td>${escapeHtml(segment.text)}</td></tr>`).join("");
  return `<!doctype html><html><head><title>Behavior Analyzer report</title><style>body{font:14px Arial;color:#142033;max-width:960px;margin:40px auto;line-height:1.5}h1{font-size:30px;margin-bottom:4px}h2{margin-top:30px;border-bottom:1px solid #dfe7f0;padding-bottom:8px}.muted,p{color:#526174}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card{border:1px solid #dfe7f0;border-radius:10px;padding:14px}.value{font-size:22px;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border-bottom:1px solid #e5ebf2;padding:8px;text-align:left;vertical-align:top}th{color:#526174;font-size:12px;text-transform:uppercase}footer{margin-top:36px;padding:15px;background:#f1f5f9;border-radius:8px;font-size:12px}</style></head><body><h1>Behavior Analyzer</h1><p class="muted">Local behavioral signal report · ${new Date().toLocaleString()}</p><h2>Media</h2><div class="grid"><div class="card"><p>Duration</p><div class="value">${formatTime(result.duration)}</div></div><div class="card"><p>Resolution</p><div class="value">${result.media.width || "—"} × ${result.media.height || "—"}</div></div><div class="card"><p>Format</p><div class="value">${escapeHtml(result.media.format || "—")}</div></div></div><h2>Overview</h2><ul>${result.summary.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h2>Behavioral baseline</h2><div class="grid">${Object.entries(result.baseline).map(([key, value]) => `<div class="card"><p>${escapeHtml(titleCase(key))}</p><div class="value">${escapeHtml(formatNumber(value))}</div></div>`).join("")}</div><h2>Timestamped events</h2><table><thead><tr><th>Time</th><th>Track</th><th>Event</th><th>Detail</th></tr></thead><tbody>${events || "<tr><td colspan=4>No events recorded.</td></tr>"}</tbody></table><h2>Transcript</h2><table><thead><tr><th>Start</th><th>End</th><th>Text</th></tr></thead><tbody>${transcript || "<tr><td colspan=3>No transcript available.</td></tr>"}</tbody></table><footer>Behavioral observations cannot reliably establish deception, honesty, intent, or a person's internal mental state. Measurements can be affected by video quality, lighting, framing, audio quality, language, and other factors. Other explanations are possible.</footer></body></html>`;
}

export default function Home() {
  const [mode, setMode] = useState<SourceMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState("");
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [timelineFilter, setTimelineFilter] = useState<(typeof categories)[number]>("All");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const next = await response.json() as JobSnapshot & { error?: string };
        if (!response.ok) throw new Error(next.error || "This analysis is no longer available.");
        if (stopped) return;
        setSnapshot(next);
        if (next.status !== "complete" && next.status !== "failed") timer = setTimeout(poll, 1400);
      } catch (pollError) {
        if (!stopped) setError(pollError instanceof Error ? pollError.message : "Could not read analysis progress.");
      }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [jobId]);

  const result = snapshot?.result || null;
  const filteredEvents = useMemo(() => result ? result.timeline.filter((event) => timelineFilter === "All" || eventCategory(event.category) === timelineFilter) : [], [result, timelineFilter]);

  const chooseFile = (nextFile: File | undefined) => {
    if (!nextFile) return;
    const extension = nextFile.name.toLowerCase().slice(nextFile.name.lastIndexOf("."));
    if (!(nextFile.type === "video/mp4" || nextFile.type === "video/quicktime" || nextFile.type === "video/webm" || !nextFile.type) || ![".mp4", ".mov", ".webm"].includes(extension)) { setError("Only MP4, MOV, and WebM videos are supported."); return; }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(nextFile); setFileUrl(URL.createObjectURL(nextFile)); setError("");
  };

  const analyze = async () => {
    setError(""); setIsSubmitting(true); setSnapshot(null);
    try {
      let response: Response;
      if (mode === "upload") {
        if (!file) throw new Error("Choose a video before analyzing.");
        const form = new FormData(); form.append("file", file);
        response = await fetch("/api/analyze/upload", { method: "POST", body: form });
      } else {
        if (!url.trim()) throw new Error("Paste a direct video URL before analyzing.");
        response = await fetch("/api/analyze/url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
      }
      const data = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !data.jobId) throw new Error(data.error || "The analysis could not be started.");
      setJobId(data.jobId);
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The analysis could not be started."); } finally { setIsSubmitting(false); }
  };

  const seek = (timestamp: number) => { if (videoRef.current) { videoRef.current.currentTime = timestamp; void videoRef.current.play().catch(() => undefined); } };
  const deleteNow = async () => { if (jobId) await fetch(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => undefined); if (fileUrl) URL.revokeObjectURL(fileUrl); setFileUrl(""); setFile(null); setJobId(""); setSnapshot(null); setUrl(""); setError(""); setTab("overview"); };
  const downloadJson = () => { if (!result) return; const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }); const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `behavior-analyzer-${result.jobId}.json`; anchor.click(); URL.revokeObjectURL(anchor.href); };
  const printReport = () => { if (!result) return; const reportWindow = window.open("", "_blank", "noopener,noreferrer"); if (!reportWindow) { setError("Allow pop-ups to open the printable report."); return; } reportWindow.document.write(buildPrintableReport(result)); reportWindow.document.close(); reportWindow.focus(); setTimeout(() => reportWindow.print(), 250); };
  const isProcessing = snapshot && snapshot.status !== "complete" && snapshot.status !== "failed";

  return <main className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark"><span /><span /><span /></span><span>Behavior Analyzer</span></div><div className="topbar-note"><span className="live-dot" /> Private local processing</div></header><div className="page-wrap">
    {!result && !isProcessing && <section className="hero-section"><div className="hero-copy"><div className="eyebrow">Behavioral signal analysis</div><h1>See what changes<br /><em>across the frame.</em></h1><p className="hero-subtitle">See behavioral changes across face, eyes, voice, movement, and speech.</p></div><div className="analyzer-card"><div className="mode-tabs"><button className={mode === "upload" ? "active" : ""} onClick={() => { setMode("upload"); setError(""); }}><Icon name="upload" size={17} /> Upload video</button><button className={mode === "url" ? "active" : ""} onClick={() => { setMode("url"); setError(""); }}><Icon name="link" size={17} /> Paste video URL</button></div>{mode === "upload" ? <label className={`drop-zone ${file ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }}><input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={(event) => chooseFile(event.target.files?.[0])} /><span className="upload-icon"><Icon name="upload" size={22} /></span>{file ? <><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB · ready to analyze</span></> : <><strong>Drop a video here</strong><span>or click to browse · MP4, MOV, WebM</span></>}</label> : <div className="url-box"><div className="url-input-wrap"><Icon name="link" size={18} /><input value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") void analyze(); }} placeholder="https://example.com/video.mp4" aria-label="Direct video URL" /></div><p>Direct downloadable video resources only. Web pages from social platforms are not supported.</p></div>}<button className="primary-button" disabled={isSubmitting} onClick={() => void analyze()}>{isSubmitting ? "Starting…" : "Analyze video"}<Icon name="chevron" size={16} /></button>{error && <div className="error-message">{error}</div>}<div className="privacy-line"><Icon name="shield" size={16} /><span>Videos are processed temporarily and automatically deleted after analysis. Results are not permanently stored.</span></div></div><div className="disclaimer"><span className="disclaimer-symbol">i</span><span>Behavioral observations cannot reliably establish deception, honesty, intent, or a person&apos;s internal mental state.</span></div></section>}

    {isProcessing && <section className="progress-card"><div className="progress-head"><div><div className="eyebrow">Analysis in progress</div><h2>{snapshot?.stage || "Preparing analysis"}</h2><p>Measurements stay on this server and are discarded automatically.</p></div><span className="progress-number">{snapshot?.progress || 0}%</span></div><div className="progress-track"><span style={{ width: `${snapshot?.progress || 0}%` }} /></div><div className="stage-list">{stageSteps.map((stage, index) => { const current = snapshot?.stage === stage; const complete = (snapshot?.progress || 0) > (index / 12) * 100; return <div className={`${current ? "current" : ""} ${complete ? "complete" : ""}`} key={stage}><span className="stage-check">{complete ? "✓" : index + 1}</span>{stage}</div>; })}</div><p className="queue-note">{snapshot?.status === "queued" ? "Queued — another analysis is currently using the CPU budget." : "CPU-friendly local processing. You can leave this tab open while the analysis runs."}</p></section>}
    {snapshot?.status === "failed" && <section className="failed-card"><div className="failed-icon">!</div><div><div className="eyebrow">Analysis could not finish</div><h2>{snapshot.error || "Something went wrong."}</h2><p>Check that the file is a valid video and try again. Temporary files will be removed automatically.</p></div><button className="secondary-button" onClick={() => void deleteNow()}>Start over</button></section>}

    {result && <section className="results-section"><div className="results-heading"><div><div className="eyebrow">Analysis complete</div><h1>Your behavioral signal map</h1><p>Timestamped measurements compared with the earlier portion of this recording.</p></div><div className="report-actions"><button className="secondary-button" onClick={downloadJson}><Icon name="download" size={16} /> JSON report</button><button className="secondary-button" onClick={printReport}><Icon name="file" size={16} /> Print / PDF</button><button className="icon-button" aria-label="Delete analysis" onClick={() => void deleteNow()}><Icon name="trash" size={17} /></button></div></div><div className="video-layout"><div className="video-card"><div className="video-topline"><span className="video-badge"><span className="live-dot" /> source preview</span><span>{formatTime(result.duration)}</span></div>{(fileUrl || mode === "url") ? <video ref={videoRef} className="video-player" controls src={fileUrl || url} /> : <div className="video-placeholder"><Icon name="play" size={40} /><span>Original source preview is unavailable for this URL.</span></div>}<div className="video-footer"><span><Icon name="clock" size={15} /> Click any event below to seek</span><span>{result.media.width || "—"} × {result.media.height || "—"}</span></div></div><div className="overview-stack"><MetricCard label="Behavioral changes" value={String(result.overview.behavioralChanges)} hint="timestamped signals" accent="blue" /><MetricCard label="Face visible" value={`${formatNumber(result.overview.faceVisiblePercentage, 0)}%`} hint="sampled frames" accent="violet" /><MetricCard label="Body visible" value={`${formatNumber(result.overview.bodyVisiblePercentage, 0)}%`} hint="sampled frames" accent="mint" /><div className="notable-card"><div className="eyebrow">Most notable</div><h3>Moments to review</h3>{result.overview.notableMoments.slice(0, 3).map((event, index) => <button className="notable-row" key={`${event.timestamp}-${index}`} onClick={() => seek(event.timestamp)}><span>{formatTime(event.timestamp)}</span><strong>{event.label}</strong><Icon name="chevron" size={14} /></button>)}{!result.overview.notableMoments.length && <p>No combined moments were detected.</p>}</div></div></div><div className="timeline-card"><div className="section-panel-head"><div><span className="eyebrow">Unified timeline</span><h2>Review measurable changes</h2></div><span className="timeline-count">{filteredEvents.length} events</span></div><div className="filter-row">{categories.map((category) => <button key={category} className={timelineFilter === category ? "selected" : ""} onClick={() => setTimelineFilter(category)}>{category}</button>)}</div><div className="timeline-events">{filteredEvents.length ? filteredEvents.slice(0, 80).map((event, index) => <EventRow event={event} onSeek={seek} key={`${event.timestamp}-${event.event}-${index}`} />) : <div className="empty-state">No timestamped events in this track.</div>}</div></div><div className="dashboard-card"><div className="dashboard-tabs">{(["overview", "eyes", "face", "voice", "body", "transcript"] as DashboardTab[]).map((item) => <button key={item} className={tab === item ? "selected" : ""} onClick={() => setTab(item)}>{item === "transcript" ? "Transcript" : item.charAt(0).toUpperCase() + item.slice(1)}</button>)}</div>{tab === "overview" && <div className="dashboard-content"><div className="dashboard-intro"><div><span className="eyebrow">Overview</span><h2>What changed, in context</h2><p>{result.overview.methodNote}</p></div><div className="baseline-chip"><span className="status-dot" /> baseline: earlier 30%</div></div><div className="section-grid"><SectionPanel title="Eyes" section={result.eyes} color="#8fb9ff" onSeek={seek} /><SectionPanel title="Face" section={result.face} color="#bc9bff" onSeek={seek} /><SectionPanel title="Voice" section={result.voice} color="#75dbbf" onSeek={seek} /><SectionPanel title="Body" section={result.body} color="#f2c47a" onSeek={seek} /></div></div>}{tab === "eyes" && <div className="dashboard-content"><SectionPanel title="Eyes" section={result.eyes} color="#8fb9ff" onSeek={seek} /></div>}{tab === "face" && <div className="dashboard-content"><SectionPanel title="Face" section={result.face} color="#bc9bff" onSeek={seek} /></div>}{tab === "voice" && <div className="dashboard-content"><SectionPanel title="Voice" section={result.voice} color="#75dbbf" onSeek={seek} /></div>}{tab === "body" && <div className="dashboard-content"><SectionPanel title="Body" section={result.body} color="#f2c47a" onSeek={seek} /></div>}{tab === "transcript" && <div className="dashboard-content"><div className="dashboard-intro"><div><span className="eyebrow">Transcript</span><h2>Timestamped speech</h2><p>Click a segment to seek the original preview.</p></div><span className="transcript-note">{result.transcript.length ? `${result.transcript.length} segments` : "No transcript available"}</span></div><div className="transcript-list">{result.transcript.length ? result.transcript.map((segment, index) => <button key={`${segment.start}-${index}`} onClick={() => seek(segment.start)}><span>{formatTime(segment.start)}</span><p>{segment.text}</p><Icon name="chevron" size={15} /></button>) : <div className="empty-state">Local transcription was unavailable for this run. Install the faster-whisper model on the VPS and run the analysis again.</div>}</div></div>}</div><div className="results-foot"><span><Icon name="shield" size={15} /> Your analysis is not saved to an account or database.</span><button onClick={() => void deleteNow()}><Icon name="trash" size={15} /> Delete Now</button></div></section>}
  </div><footer className="site-footer"><span>Behavior Analyzer · local-first analysis</span><span>Built for careful review, not certainty.</span></footer></main>;
}
