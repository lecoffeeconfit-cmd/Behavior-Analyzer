import { build } from "esbuild";
await build({ entryPoints: ["packages/analysis/src/vision-worker.ts"], outfile: "apps/web/public/vision-worker.js", bundle: true, format: "iife", platform: "browser", target: "es2022", minify: true, legalComments: "eof" });
