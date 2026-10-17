import { estimatePitch, mean } from "./signals";
import type { AudioResult, VoiceSample } from "@video-analyzer/shared/types";

export async function startAudioCapture(localVideo?: HTMLVideoElement): Promise<{ stop: () => Promise<AudioResult> }> {
  // Invoked directly by the Analyze click. Chrome presents its native chooser.
  // No microphone permission, automatic recording, or protected stream access.
  const stream = localVideo
    ? (localVideo as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream()
    : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: false } as DisplayMediaStreamOptions);
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(localVideo ? "This file exposes no audio track. Turn audio off to analyze visuals and captions." : "No tab audio was shared. Select the video tab and enable “Share tab audio”, or turn audio off and analyze visuals/captions.");
  }
  const audioOnly = new MediaStream(stream.getAudioTracks());
  let context: AudioContext | undefined;
  try {
    context = new AudioContext(); await context.resume();
    const source = context.createMediaStreamSource(audioOnly), analyser = context.createAnalyser();
    analyser.fftSize = 2048; source.connect(analyser);
    const samples: VoiceSample[] = [], chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(audioOnly, { mimeType });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.start(250);
    const started = performance.now();
    const timer = setInterval(() => {
      const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
      samples.push({ timestamp: (performance.now() - started) / 1000, rms: Math.sqrt(mean(Array.from(data, (v) => v * v))), pitch: estimatePitch(data, context!.sampleRate) });
    }, 200);
    let stopped: Promise<AudioResult> | undefined;
    const stop = (): Promise<AudioResult> => {
      if (stopped) return stopped;
      stopped = new Promise((resolve) => {
        clearInterval(timer); clearTimeout(deadline);
        const finish = () => {
          stream.getTracks().forEach((track) => track.stop()); source.disconnect();
          void context!.close();
          resolve({ samples, blob: chunks.length ? new Blob(chunks, { type: mimeType }) : null, clock: "elapsed", warning: "Audio timestamps are capture elapsed time, not player timestamps. Shared-tab audio can include other sounds; pitch is not an emotion or truthfulness measure." });
        };
        if (recorder.state === "inactive") finish();
        else { recorder.onstop = finish; recorder.stop(); }
      });
      return stopped;
    };
    const deadline = setTimeout(() => { void stop(); }, 15_000);
    // A closed panel or manually ended Chrome share stops recording immediately.
    stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => void stop(), { once: true }));
    const unload = () => { stream.getTracks().forEach((track) => track.stop()); clearInterval(timer); void context!.close(); };
    window.addEventListener("pagehide", unload, { once: true });
    return { stop: async () => { const result = await stop(); window.removeEventListener("pagehide", unload); return result; } };
  } catch (error) { stream.getTracks().forEach((track) => track.stop()); void context?.close(); throw error; }
}
