import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
await mkdir("release", { recursive: true });
await rm("release/video-analyzer-1.0.0.zip", { force: true });
execFileSync("zip", ["-q", "-r", "../../release/video-analyzer-1.0.0.zip", ".", "-x", "*.map", ".DS_Store"], { cwd: "dist/extension", stdio: "inherit" });
console.log("Chrome Web Store archive: release/video-analyzer-1.0.0.zip (manifest at archive root).");
