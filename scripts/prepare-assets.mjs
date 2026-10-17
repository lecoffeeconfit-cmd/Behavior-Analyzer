import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { generateIcons } from "./generate-icons.mjs";

const root = new URL("../packages/analysis/", import.meta.url);
await mkdir(new URL("models/", root), { recursive: true });
const models = [
  ["face_landmarker.task", "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"],
  ["pose_landmarker_lite.task", "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"],
];
const lockPath = new URL("model-checksums.json", root);
let checksums = {};
try { checksums = JSON.parse(await readFile(lockPath, "utf8")); } catch { /* First-time asset preparation. */ }
for (const [name, url] of models) {
  const target = new URL(`models/${name}`, root);
  let data;
  try { data = await readFile(target); } catch {
    console.log(`Downloading pinned MediaPipe model: ${name}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  const digest = createHash("sha256").update(data).digest("hex");
  if (checksums[name] && checksums[name] !== digest) throw new Error(`Checksum mismatch for ${name}. Remove the corrupt local file and rerun npm run assets.`);
  checksums[name] = digest;
  await writeFile(target, data);
}
await writeFile(lockPath, `${JSON.stringify(checksums, null, 2)}\n`);
for (const app of ["web", "extension"]) {
  const output = new URL(`../apps/${app}/public/`, import.meta.url);
  await mkdir(new URL("models/", output), { recursive: true });
  await mkdir(new URL("wasm/", output), { recursive: true });
  for (const [name] of models) await copyFile(new URL(`models/${name}`, root), new URL(`models/${name}`, output));
  for (const name of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
    await copyFile(new URL(`../node_modules/@mediapipe/tasks-vision/wasm/${name}`, import.meta.url), new URL(`wasm/${name}`, output));
  }
}
await generateIcons();
console.log("Local models, WASM, and icons are ready. Runtime analysis requires no downloads.");
