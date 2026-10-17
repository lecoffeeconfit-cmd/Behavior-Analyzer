import { build as viteBuild } from "vite";
import { build, context } from "esbuild";
import { stat } from "node:fs/promises";
const watch = process.argv.includes("--watch");
for (const path of ["apps/extension/public/models/face_landmarker.task", "apps/extension/public/models/pose_landmarker_lite.task", "apps/extension/public/wasm/vision_wasm_internal.wasm"]) {
  try { await stat(path); } catch { throw new Error("Assets are missing. Run npm run assets once before building; models are packaged locally."); }
}
await viteBuild({ build: { watch: watch ? {} : null } });
for (const entry of ["background", "content", "vision-worker"]) {
  const options = { entryPoints: [entry === "vision-worker" ? "packages/analysis/src/vision-worker.ts" : `apps/extension/src/${entry}.ts`], outfile: `dist/extension/${entry}.js`, bundle: true, format: entry === "background" ? "esm" : "iife", target: "chrome116", minify: !watch, sourcemap: watch ? "inline" : false, logLevel: "info", legalComments: "eof" };
  if (watch) { const task = await context(options); await task.watch(); }
  else await build(options);
}
console.log(watch ? "Watching extension source. Load dist/extension in chrome://extensions, then reload the extension after changes." : "Standalone Chrome extension built in dist/extension/.");
