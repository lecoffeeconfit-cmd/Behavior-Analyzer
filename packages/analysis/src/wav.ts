// Canonical, bounded PCM16 WAV for auditable server-side duration/cost limits.
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const rate = 16000, count = Math.min(rate * 12, Math.floor(samples.length * rate / sampleRate));
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) { const index = i * sampleRate / rate, left = Math.floor(index), fraction = index - left; const sample = Math.max(-1, Math.min(1, samples[left] * (1 - fraction) + (samples[Math.min(samples.length - 1, left + 1)] || 0) * fraction)); view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); }
  return bytes;
}
export async function audioBlobToBase64Wav(blob: Blob): Promise<string> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(Math.min(decoded.length, Math.ceil(decoded.sampleRate * 12)));
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) { const channel = decoded.getChannelData(ch); for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / decoded.numberOfChannels; }
    const bytes = encodeWav(mono, decoded.sampleRate);
    let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  } finally { await context.close(); }
}
