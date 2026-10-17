export function clamp(value: number, min = 0, max = 1): number { return Math.min(max, Math.max(min, value)); }
export function mean(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }

export function frameSignals(pixels: Uint8ClampedArray, width: number, height: number, previous?: Uint8ClampedArray) {
  let sum = 0, squares = 0, red = 0, blue = 0, movement = 0;
  let edge = 0, boundary = 0, interior = 0, edgeCount = 0, boundaryCount = 0, interiorCount = 0;
  const cells = Array.from({ length: 48 }, () => ({ sum: 0, count: 0 }));
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    sum += luminance; squares += luminance * luminance; red += pixels[i]; blue += pixels[i + 2];
    const pixelIndex = i / 4, pixelX = pixelIndex % width, pixelY = Math.floor(pixelIndex / width);
    for (const [neighbor, isBoundary] of [[pixelX > 0 ? i - 4 : -1, pixelX % 8 === 0], [pixelY > 0 ? i - width * 4 : -1, pixelY % 8 === 0]] as const) {
      if (neighbor < 0) continue;
      const delta = Math.abs(luminance - (0.2126 * pixels[neighbor] + 0.7152 * pixels[neighbor + 1] + 0.0722 * pixels[neighbor + 2]) / 255);
      edge += delta; edgeCount++;
      if (isBoundary) { boundary += delta; boundaryCount++; } else { interior += delta; interiorCount++; }
    }
    if (previous?.length === pixels.length) {
      const delta = (Math.abs(pixels[i] - previous[i]) + Math.abs(pixels[i + 1] - previous[i + 1]) + Math.abs(pixels[i + 2] - previous[i + 2])) / 765;
      movement += delta;
      const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
      const cell = cells[Math.min(47, Math.floor(y / height * 6) * 8 + Math.floor(x / width * 8))];
      cell.sum += delta; cell.count++;
    }
  }
  const count = pixels.length / 4, brightness = sum / Math.max(1, count);
  return { brightness, contrast: Math.sqrt(Math.max(0, squares / Math.max(1, count) - brightness ** 2)), warmth: (red - blue) / Math.max(1, count) / 255, motion: movement / Math.max(1, count), heatmap: cells.map((cell) => cell.count ? cell.sum / cell.count : 0), edgeEnergy: edge / Math.max(1, edgeCount), blockBoundaryExcess: Math.max(0, boundary / Math.max(1, boundaryCount) - interior / Math.max(1, interiorCount)) };
}

export function estimatePitch(samples: Float32Array, sampleRate: number): number | null {
  const rms = Math.sqrt(mean(Array.from(samples, (value) => value * value)));
  if (rms < 0.008) return null;
  // Normalized autocorrelation; pitch estimates are acoustic signals, not emotions.
  let best = 0, lag = 0;
  const correlations: Array<{ offset: number; score: number }> = [];
  for (let offset = Math.floor(sampleRate / 450); offset <= Math.floor(sampleRate / 65); offset++) {
    let correlation = 0, powerA = 0, powerB = 0;
    for (let index = 0; index < samples.length - offset; index += 2) {
      correlation += samples[index] * samples[index + offset];
      powerA += samples[index] ** 2; powerB += samples[index + offset] ** 2;
    }
    const normalized = correlation / Math.max(1e-9, Math.sqrt(powerA * powerB));
    correlations.push({ offset, score: normalized });
    if (normalized > best) { best = normalized; lag = offset; }
  }
  // Prefer the earliest strong local peak so a more exact second/third period
  // does not routinely halve/third the fundamental frequency.
  const firstPeak = correlations.find((point, i) => i > 0 && i < correlations.length - 1 && point.score >= best * 0.95 && point.score >= correlations[i - 1].score && point.score >= correlations[i + 1].score);
  if (firstPeak) lag = firstPeak.offset;
  return best > 0.65 && lag ? sampleRate / lag : null;
}
