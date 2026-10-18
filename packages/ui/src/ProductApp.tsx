"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductPlatform } from "@video-analyzer/shared/platform";
import type { AudioResult, CaptureResult, VideoReport, VideoSource } from "@video-analyzer/shared/types";
import { DEFAULT_PLAN, FREE_FEATURES, OFFLINE_ENTITLEMENT, PRO_FEATURES } from "@video-analyzer/shared/plans";
import type { Entitlement } from "@video-analyzer/shared/plans";
import { formatTime } from "@video-analyzer/shared/format";
import { clearReports, deleteReport, listReports, saveReport, searchReports } from "@video-analyzer/shared/storage";
import { observeVideo } from "@video-analyzer/analysis/capture";
import { analyzeVision } from "@video-analyzer/analysis/vision";
import { buildReport } from "@video-analyzer/analysis/report";
import { startAudioCapture } from "@video-analyzer/analysis/audio";
import { inspectFileMetadata } from "@video-analyzer/analysis/metadata";
import { Icon } from "./Visuals";
import { ReportView } from "./ReportView";

type View = "analyze" | "history" | "pro";
export function ProductApp({ platform }: { platform: ProductPlatform }) {
  const [view, setView] = useState<View>("analyze"), [mode, setMode] = useState<"page" | "file" | "url">(platform.kind === "extension" ? "page" : "file");
  const [videos, setVideos] = useState<VideoSource[]>([]), [selected, setSelected] = useState("");
  const [detecting, setDetecting] = useState(false), [pageNotes, setPageNotes] = useState<string[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [report, setReport] = useState<VideoReport | null>(null), [history, setHistory] = useState<VideoReport[]>([]), [search, setSearch] = useState("");
  const [progress, setProgress] = useState(0), [stage, setStage] = useState(""), [busy, setBusy] = useState(false), [seconds, setSeconds] = useState(12), [withAudio, setWithAudio] = useState(false);
  const [localUrl, setLocalUrl] = useState(""), [urlInput, setUrlInput] = useState(""), [localSource, setLocalSource] = useState<VideoSource | null>(null);
  const [localName, setLocalName] = useState("");
  const [audio, setAudio] = useState<{ reportId: string; blob: Blob | null } | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement>(OFFLINE_ENTITLEMENT), [backend, setBackend] = useState(""), [accountBusy, setAccountBusy] = useState(false);
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [compare, setCompare] = useState<string[]>([]), [comparison, setComparison] = useState(""), [compareBusy, setCompareBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null), fileRef = useRef<File | null>(null), localId = useRef("");
  const run = useRef<{ id: string; source: VideoSource; controller: AbortController } | null>(null);
  const alive = useRef(true), detectionEpoch = useRef(0);

  const refreshHistory = useCallback(async () => { try { const rows = await listReports(); if (alive.current) setHistory(rows); } catch (e) { setError(message(e)); } }, []);
  const refreshAccount = useCallback(async () => { try { setEntitlement(await platform.account()); } catch { setEntitlement(OFFLINE_ENTITLEMENT); } }, [platform]);
  const detect = useCallback(async () => {
    const epoch = ++detectionEpoch.current; setDetecting(true);
    try {
      const found = await platform.detect();
      if (alive.current && epoch === detectionEpoch.current) {
        setVideos(found.videos); setPageNotes(found.warnings);
        setSelected((previous) => found.videos.some((v) => v.id === previous) ? previous : found.videos.find((v) => v.visible)?.id || found.videos[0]?.id || "");
        setError("");
      }
    } catch (e) { if (epoch === detectionEpoch.current) { setVideos([]); setSelected(""); setPageNotes([message(e)]); } }
    finally { if (epoch === detectionEpoch.current) setDetecting(false); }
  }, [platform]);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => { if (alive.current) { void refreshHistory(); void refreshAccount(); if (platform.kind === "extension") void detect(); } });
    void platform.getBackend().then(setBackend).catch(() => undefined);
    const unsubscribe = platform.onProgress((id, value, text) => { if (run.current?.id === id && !run.current.controller.signal.aborted) { setProgress(value); setStage(text); } });
    const pageChange = platform.onPageChange?.(() => { if (!run.current) void detect(); });
    return () => { alive.current = false; unsubscribe(); pageChange?.(); if (run.current) { run.current.controller.abort(); void platform.cancel(run.current.source, run.current.id).catch(() => undefined); } };
  }, [platform, refreshHistory, refreshAccount, detect]);
  useEffect(() => () => { if (localUrl.startsWith("blob:")) URL.revokeObjectURL(localUrl); }, [localUrl]);

  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 500 * 1024 * 1024) { setError("Choose a video smaller than 500 MB."); return; }
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) { setError("Choose a video file such as MP4 or WebM."); return; }
    setError(""); setLocalSource(null); setReport(null); setAudio(null); fileRef.current = file; setLocalName(file.name);
    localId.current = crypto.randomUUID(); setLocalUrl(URL.createObjectURL(file));
  };
  const loadUrl = () => {
    try {
      const url = new URL(urlInput);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use a public HTTP(S) direct video URL without credentials.");
      setError(""); setLocalSource(null); setReport(null); setAudio(null); fileRef.current = null; setLocalName("");
      localId.current = crypto.randomUUID(); setLocalUrl(url.href);
    } catch (e) { setError(message(e)); }
  };
  const loaded = async () => {
    const video = videoRef.current; if (!video) return;
    const id = localId.current;
    const metadata = fileRef.current ? await inspectFileMetadata(fileRef.current) : { source: "CORS-enabled direct URL", provenanceVerification: "Not performed" };
    if (id !== localId.current) return;
    setLocalSource({ id, tabId: -1, frameId: 0, documentId: "local", title: fileRef.current?.name || "Direct video", pageUrl: fileRef.current ? "local://device" : localUrl.split("?")[0], sourceKind: fileRef.current ? "Local upload" : "Direct URL", duration: Number.isFinite(video.duration) ? video.duration : 0, currentTime: video.currentTime, width: video.videoWidth, height: video.videoHeight, paused: video.paused, protected: !!video.mediaKeys, captions: video.textTracks.length, visible: true, metadata });
  };
  const source = mode === "page" ? videos.find((v) => v.id === selected) : localSource;
  const local = mode !== "page";
  const analyze = async () => {
    if (!source || busy) return;
    setError(""); setNotice(""); setBusy(true); setProgress(2); setStage("Preparing local analysis"); setReport(null); setAudio(null);
    const current = { id: crypto.randomUUID(), source, controller: new AbortController() }; run.current = current;
    let recorder: Awaited<ReturnType<typeof startAudioCapture>> | null = null;
    try {
      if (withAudio && seconds > 0 && !source.protected) {
        setStage(local ? "Preparing file audio" : "Choose the video tab & share its audio");
        if (local && videoRef.current?.paused) await videoRef.current.play();
        recorder = await startAudioCapture(local ? videoRef.current! : undefined);
      }
      if (current.controller.signal.aborted) throw new Error("Analysis cancelled.");
      const capture: CaptureResult = local && videoRef.current
        ? await observeVideo(videoRef.current, source, { seconds, signal: current.controller.signal, progress: (value, text) => { setProgress(value); setStage(text); } })
        : await platform.capture(source, current.id, seconds);
      const audioResult: AudioResult | null = recorder ? await recorder.stop() : null; recorder = null;
      if (current.controller.signal.aborted) throw new Error("Analysis cancelled.");
      setProgress(62); setStage("Loading local landmark models");
      const vision = await analyzeVision(capture.frames, current.controller.signal, (value, text) => { setProgress(value); setStage(text); }, platform.assetBase);
      if (current.controller.signal.aborted) throw new Error("Analysis cancelled.");
      const result = buildReport(capture, vision, capture.source.protected ? null : audioResult);
      setProgress(96); setStage("Saving your report on this device");
      if (alive.current) { setReport(result); setAudio(audioResult?.blob && !capture.source.protected ? { reportId: result.id, blob: audioResult.blob } : null); }
      try { await saveReport(result); await refreshHistory(); setNotice("Analysis complete · saved on this device"); }
      catch (e) { setError(message(e)); }
      setProgress(100);
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { if (recorder) await recorder.stop(); run.current = null; if (alive.current) setBusy(false); }
  };
  const cancel = () => { run.current?.controller.abort(); if (run.current && run.current.source.documentId !== "local") void platform.cancel(run.current.source, run.current.id).catch(() => undefined); };
  const seek = async (timestamp: number) => {
    setError("");
    try { if (report?.source.id === localSource?.id && videoRef.current) videoRef.current.currentTime = timestamp; else if (report) await platform.seek(report.source, timestamp); }
    catch (e) { setError(message(e)); }
  };
  const updateReport = async (result: VideoReport) => { await saveReport(result); setReport(result); await refreshHistory(); };
  const accountAction = async (register = false) => {
    setAccountBusy(true); setError(""); setNotice("");
    try { await platform.login(email, password, register); setPassword(""); await refreshAccount(); setNotice("Signed in. Free features still run locally."); }
    catch (e) { setError(message(e)); }
    finally { setPassword(""); setAccountBusy(false); }
  };
  const compareReports = async () => {
    setCompareBusy(true); setError("");
    try { setComparison(await platform.ask(history.filter((r) => compare.includes(r.id)), "Compare these observed video windows: shared activities, differing movements, caption topics, lighting and limitations. Cite which report and timestamp supports each comparison. Do not infer mental states or authenticity.")); await refreshAccount(); }
    catch (e) { setError(message(e)); } finally { setCompareBusy(false); }
  };
  const price = new Intl.NumberFormat("en-US", { style: "currency", currency: entitlement.currency }).format(entitlement.monthlyPriceCents / 100);

  return <main className={`product-shell ${platform.kind}`}>
    <header className="topbar"><a className="brand" href={platform.kind === "web" ? "/" : "#"} onClick={(e) => { e.preventDefault(); setView("analyze"); }}><span className="brand-mark"><i/><i/><i/></span><span>Video<span className="brand-light">Analyzer</span><small>FRAME BY FRAME</small></span></a><span className="plan-pill">{entitlement.tier === "pro" ? "PRO" : "FREE"}<i/></span></header>
    <nav className="main-nav" aria-label="Main navigation">{([["analyze", "scan", "Workbench"], ["history", "history", "Library"], ["pro", "spark", "Pro & account"]] as const).map(([name, icon, text]) => <button key={name} onClick={() => setView(name)} className={view === name ? "active" : ""}><Icon name={icon} size={16}/>{text}{name === "history" && history.length > 0 && <span>{history.length}</span>}</button>)}</nav>
    <div className="workspace">
      {error && <div className="alert" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><Icon name="close" size={14}/></button></div>}
      {notice && <div className="success" role="status"><Icon name="check" size={14}/>{notice}</div>}
      <div className={view === "analyze" ? "workbench-layout" : "hidden"}>
        <div className="input-column"><section className="intro"><div className="eyebrow"><span className="live-dot"/> PRIVATE VIDEO INTELLIGENCE</div><h1>Every frame.<br/><em>A clearer picture.</em></h1><p>Read the signals. Review the evidence.<br/>Keep your video on your device.</p></section>
        <section className="card source-card"><div className="section-heading"><Icon name="play"/><h3>Your video</h3><span className="pill mint">FREE FOREVER</span></div>
          <div className="source-tabs">{platform.kind === "extension" && <button disabled={busy} onClick={() => setMode("page")} className={mode === "page" ? "active" : ""}>Current page</button>}<button disabled={busy} onClick={() => setMode("file")} className={mode === "file" ? "active" : ""}>Local file</button>{platform.kind === "web" && <button disabled={busy} onClick={() => setMode("url")} className={mode === "url" ? "active" : ""}>Direct URL</button>}</div>
          {mode === "page" && <><div className="detected-heading"><span>{detecting ? "Looking for videos…" : `${videos.length} video${videos.length === 1 ? "" : "s"} detected`}</span><button className="icon-button" disabled={detecting || busy} onClick={() => void detect()} aria-label="Refresh videos"><Icon name="refresh" size={15}/></button></div>{videos.length ? <div className="video-options">{videos.map((video, i) => <label key={video.id} className={`video-option ${selected === video.id ? "selected" : ""}`}><input type="radio" name="video" value={video.id} checked={selected === video.id} disabled={busy} onChange={() => setSelected(video.id)}/><span className="video-symbol"><Icon name="play" size={16}/><small>{String(i + 1).padStart(2, "0")}</small></span><span><strong>{video.title}</strong><small>{video.width || "?"} × {video.height || "?"} · {video.duration ? formatTime(video.duration) : "Live / unknown"} · {video.protected ? "Protected" : video.sourceKind}</small></span><span className="radio-dot"/></label>)}</div> : <div className="empty-inline"><Icon name="scan" size={28}/><strong>No accessible video yet</strong><p>Play a video on the page, then refresh. Click the toolbar icon on the video tab to grant page access.</p></div>}<details className="page-notes"><summary>Page access notes</summary>{pageNotes.map((note, i) => <p key={i}>{note}</p>)}</details></>}
          {mode === "file" && <label className="drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) void chooseFile(e.dataTransfer.files[0]); }}><input disabled={busy} type="file" accept="video/*,.mp4,.webm,.mov" onChange={(e) => void chooseFile(e.target.files?.[0])}/><span><Icon name="file" size={24}/></span><strong>{localName || "Drop a video into focus"}</strong><small>or choose a local file · MP4, WebM · up to 500 MB</small><p>Your file stays in this browser.</p></label>}
          {mode === "url" && <><label className="field-label">Public direct video URL<input type="url" value={urlInput} disabled={busy} placeholder="https://example.com/video.mp4" onChange={(e) => setUrlInput(e.target.value)}/></label><button className="secondary full" disabled={busy || !urlInput} onClick={loadUrl}>Load video</button><p className="small muted">Requires the video server to allow CORS. Social page links need the Chrome extension.</p></>}
          <div className={!localUrl || mode === "page" ? "hidden" : "local-player-wrap"}><video crossOrigin="anonymous" ref={videoRef} src={localUrl || undefined} controls playsInline onLoadedMetadata={() => void loaded().catch((e) => setError(message(e)))} onError={() => { if (localUrl) setError("Chrome could not decode this video or the server blocked CORS. Try a supported local MP4/WebM file."); }}/><small>Play the video to observe movement. Paused players produce a still-frame report.</small></div>
          <div className="analysis-options"><label className="field-label">Observation window<select disabled={busy} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}><option value={12}>Observe up to 12 seconds · ~4 fps</option><option value={0}>Current frame · quick inspection</option></select></label><label className="check-row"><input disabled={busy || source?.protected || seconds === 0} type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)}/><span>Include acoustic signals<small>{local ? "Reads the file's accessible audio track." : "Chrome asks you to share the video tab's audio."}</small></span></label></div>
          {source?.protected && <div className="notice small">Protected player: only accessible metadata and captions will be analyzed.</div>}
          <button className="primary full" disabled={!source || busy || detecting} onClick={() => void analyze()}>{busy ? "Analysis in progress…" : "Analyze video"}<Icon name="arrow"/></button><div className="privacy-note"><Icon name="shield" size={14}/><span>Local processing. No account. No AI API required.</span></div>
        </section>
        <div className="free-note"><span className="mini-orbit"/><div><strong>Signals, not assumptions.</strong><p>Movement and voice cannot establish trust, fear, intentions, or truthfulness.</p></div></div></div>
        <div className="results-column">{busy ? <section className="progress-card" aria-live="polite"><div className="processing-orbit"><Icon name="scan" size={40}/><i/><i/></div><span className="eyebrow">ON-DEVICE ANALYSIS</span><h2>Connecting the signals.</h2><p>{stage}</p><div className="progress-track"><span style={{ width: `${progress}%` }}/></div><div className="progress-info"><strong>{Math.round(progress)}%</strong><span>{progress < 62 ? "01 / Capture" : progress < 95 ? "02 / Landmarks" : "03 / Report"}</span></div><div className="progress-steps">{["Observe", "Map", "Save"].map((text, i) => <span className={progress >= [2, 62, 95][i] ? "active" : ""} key={text}><i/>{text}</span>)}</div><button className="text-button" onClick={cancel}>Cancel analysis</button></section> : report ? <ReportView key={report.id} report={report} onSeek={(time) => void seek(time)} onUpdate={updateReport} audioBlob={audio?.reportId === report.id ? audio.blob : null} notify={setError} platform={platform} entitlement={entitlement} refreshAccount={() => void refreshAccount()}/> : <section className="ready-card"><div className="ready-graphic"><div className="orbit-ring r1"/><div className="orbit-ring r2"/><div className="orbit-ring r3"/><span className="ready-center"><Icon name="scan" size={38}/></span><span className="orbit-label l1">FACE</span><span className="orbit-label l2">MOTION</span><span className="orbit-label l3">VOICE</span></div><span className="eyebrow">YOUR EVIDENCE WORKSPACE</span><h2>Look a little closer.</h2><p>Choose a video and select Analyze.<br/>Measured insights will appear here.</p><div className="ready-tags"><span><Icon name="eye" size={13}/> Landmarks</span><span><Icon name="shield" size={13}/> Authenticity</span><span><Icon name="history" size={13}/> Timeline</span></div><small>No simulated measurements. Every chart starts with your video.</small></section>}</div>
      </div>
      {view === "history" && <section className="history-page animate-in"><div className="page-heading"><span className="eyebrow">YOUR LOCAL LIBRARY</span><h1>Keep the context.</h1><p>Reports saved in this browser. Search captions, observations, and video titles.</p></div><label className="search-field"><Icon name="search"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your reports" aria-label="Search local history"/></label><div className="history-actions"><span>{history.length} saved report{history.length === 1 ? "" : "s"}</span><button className="text-button danger" disabled={!history.length} onClick={() => { if (confirm("Delete all locally saved reports? This cannot be undone.")) void clearReports().then(refreshHistory).catch((e) => setError(message(e))); }}>Clear library</button></div>{searchReports(history, search).map((row) => <article className="history-card" key={row.id}><button className="history-open" onClick={() => { setReport(row); setAudio(null); setView("analyze"); }}>{row.frames.find((f) => f.image)?.image ? <img src={row.frames.find((f) => f.image)!.image} alt="Saved video frame"/> : <span className="history-placeholder"><Icon name="file"/></span>}<div><strong>{row.source.title}</strong><small>{new Date(row.createdAt).toLocaleString()} · {formatTime(row.start)}–{formatTime(row.end)}</small><p>{row.events.length} review cues · {row.transcript.length} captions</p></div><Icon name="arrow" size={15}/></button><div className="history-card-footer"><label><input type="checkbox" checked={compare.includes(row.id)} disabled={!compare.includes(row.id) && compare.length >= 3} onChange={(e) => setCompare(e.target.checked ? [...compare, row.id] : compare.filter((id) => id !== row.id))}/>Compare <span className="pill">PRO</span></label><button className="icon-button danger" aria-label={`Delete ${row.source.title}`} onClick={() => { void deleteReport(row.id).then(async () => { setCompare((ids) => ids.filter((id) => id !== row.id)); if (report?.id === row.id) setReport(null); await refreshHistory(); }).catch((e) => setError(message(e))); }}><Icon name="trash" size={15}/></button></div></article>)}{!searchReports(history, search).length && <div className="empty-inline"><Icon name="history" size={32}/><h3>{history.length ? "No matching reports" : "Your library starts here"}</h3><p>Analyze a video to save a report. Free history is stored locally with no account.</p></div>}<button className="secondary full" disabled={compare.length < 2 || compareBusy || entitlement.tier !== "pro" || entitlement.remaining < entitlement.requestCredits} onClick={() => void compareReports()}>{compareBusy ? "Comparing evidence…" : `Compare ${compare.length} reports with Pro`}<Icon name="spark"/></button><p className="small muted">Sends selected reports and up to 3 sampled frames per report. Costs {entitlement.requestCredits} credit(s). {entitlement.remaining} remaining.</p>{comparison && <div className="answer"><span className="eyebrow">PRO COMPARISON</span><p>{comparison}</p></div>}</section>}
      {view === "pro" && <section className="plans-page animate-in"><div className="page-heading"><span className="eyebrow">MORE CONTEXT, YOUR CHOICE</span><h1>Local at heart.<br/><em>Pro when you need it.</em></h1><p>Free stays free. Cloud processing is always explicit and metered.</p></div><div className="plan-grid"><article className="card free-plan"><span className="eyebrow">FREE · PERMANENTLY</span><h2>$0 <small>forever</small></h2><p>Private intelligence on your device.</p>{FREE_FEATURES.map((item) => <p className="feature" key={item}><Icon name="check" size={15}/>{item}</p>)}<span className="pill mint">NO ACCOUNT REQUIRED</span></article><article className="card pro-plan"><span className="eyebrow">VIDEO ANALYZER PRO</span><h2>{price} <small>/ month</small></h2><p>Optional cloud reasoning, with boundaries.</p>{PRO_FEATURES.map((item) => <p className="feature" key={item}><Icon name="check" size={15}/>{item}</p>)}<p className="small muted">Advanced manipulation review is model-dependent and remains inconclusive without validated forensic evidence. Audio-visual consistency requires a supporting model; it is not enabled in the default text/image adapter.</p><div className="allowance"><div><span>{entitlement.tier === "pro" ? "Credits remaining" : "Planned monthly allowance"}</span><strong>{entitlement.tier === "pro" ? `${entitlement.remaining} / ${entitlement.allowance}` : `${DEFAULT_PLAN.monthlyCredits} credits`}</strong></div><div className="progress-track"><span style={{ width: entitlement.allowance ? `${entitlement.remaining / entitlement.allowance * 100}%` : "0%" }}/></div><small>{entitlement.renewsAt ? `Renews ${new Date(entitlement.renewsAt).toLocaleDateString()}` : "Account and usage availability depend on the configured backend."}</small></div><div className="notice">{entitlement.billingReady ? "Test billing integration is configured. Live charges are disabled for this implementation phase." : "Billing is not activated. No charges or subscriptions are created by this interface."}</div></article></div><section className="card account-card"><div className="section-heading"><Icon name="shield"/><h3>Optional Pro account</h3><span className="pill">{entitlement.authenticated ? entitlement.tier.toUpperCase() : "NOT CONNECTED"}</span></div>{platform.kind === "extension" && <><label className="field-label">Your deployed secure backend<input type="url" value={backend} onChange={(e) => setBackend(e.target.value)} placeholder="https://your-netlify-site.netlify.app"/></label><button className="secondary full" onClick={() => { setError(""); void platform.setBackend(backend).then(refreshAccount).then(() => setNotice("Backend connected. Sign in to check Pro entitlement.")).catch((e) => setError(message(e))); }}>Connect backend</button><p className="small muted">Only Pro needs this connection. Chrome asks for permission to contact the exact configured host.</p></>}{entitlement.authenticated ? <><p className="muted">Signed in · {entitlement.tier === "pro" ? `${entitlement.remaining} credits remaining` : "Free account"}</p><button className="secondary" onClick={() => { void platform.logout().then(refreshAccount); }}>Sign out</button></> : <><label className="field-label">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"/></label><label className="field-label">Password<input type="password" value={password} minLength={12} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"/></label><div className="button-row"><button className="primary" disabled={accountBusy || !email || !password} onClick={() => void accountAction(false)}>Sign in</button><button className="secondary" disabled={accountBusy || !email || password.length < 12} onClick={() => void accountAction(true)}>Create account</button></div><p className="small muted">Accounts require a configured authentication backend. Session credentials stay in Chrome session storage or this browser tab and are never included in reports.</p></>}<button className="text-button" onClick={() => void refreshAccount()}>Refresh subscription & allowance</button></section></section>}
    </div><footer className="app-footer"><span className="live-dot"/> Video Analyzer · {platform.kind === "web" ? "Web" : "Chrome"} · Local first</footer>
  </main>;
}
function message(error: unknown): string { return error instanceof Error ? error.message : "The operation could not be completed."; }
