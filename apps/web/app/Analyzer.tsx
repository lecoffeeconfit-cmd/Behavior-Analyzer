"use client";
import { ProductApp } from "@video-analyzer/ui";
import type { ProductPlatform } from "@video-analyzer/shared/platform";
import { createCloudClient } from "@video-analyzer/shared/cloud-client";
import { audioBlobToBase64Wav } from "@video-analyzer/analysis/wav";
const cloud = createCloudClient({ getEndpoint: async () => location.origin, getToken: async () => sessionStorage.getItem("va-account") || "", setToken: async (token) => { if (token) sessionStorage.setItem("va-account", token); else sessionStorage.removeItem("va-account"); } });
const platform: ProductPlatform = {
  kind: "web", assetBase: "/", ...cloud,
  transcribe: async (blob) => cloud.transcribeWav(await audioBlobToBase64Wav(blob)),
  detect: async () => ({ videos: [], warnings: ["The website can analyze local uploads and CORS-enabled direct video URLs. Install the Chrome extension to inspect videos embedded on other websites."] }),
  capture: async () => { throw new Error("Choose an uploaded video first."); },
  cancel: async () => undefined,
  seek: async () => { throw new Error("The original player is not available in this session."); },
  onProgress: () => () => undefined,
  setBackend: async () => undefined, getBackend: async () => typeof location === "undefined" ? "" : location.origin,
};
export default function Analyzer() { return <ProductApp platform={platform}/>; }
