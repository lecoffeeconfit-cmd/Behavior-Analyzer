# One repository, two products

```text
apps/web              Next.js website + optional secure Pro API
apps/extension        Vite/React MV3 side panel, content script, service worker
packages/analysis     Capture, MediaPipe worker, signal measurements, reports, audio
packages/shared       Types, IndexedDB history, plan definitions, API client
packages/ui           ProductApp, report views, charts, shared design system
scripts               Shared asset preparation, independent builds, packaging, smoke tests
```

Both apps import the same actual React screens and analysis functions. Platform adapters isolate Chrome detection, messaging, side panel, storage-session credentials, and player seeking. Neither the extension nor the shared engine imports Next.js server code. Both run the same packaged face/pose models in a classic worker, keeping inference off the UI thread.

The extension uses `activeTab`, `scripting`, `sidePanel`, and `storage`. Clicking its icon opens the side panel. Detection injects the content script only into accessible frames in the chosen tab. Stable per-element identifiers and Chrome document IDs prevent a saved timestamp from accidentally targeting a replacement document. An explicit optional backend connection requests access to only that host. No persistent all-sites permission, microphone access, cookies permission, network interception, or remote executable code is used.

An analysis observes current playback for up to 12 seconds at approximately 4 fps, or inspects a still frame. It does not silently play, seek, unmute, or download an embedded video. Local audio is the one exception: if explicitly enabled, Analyze starts the uploaded file so its audio can be read. Frame decoding/canvas access remains subject to normal CORS and encryption restrictions. Local files and frames are analyzed in the browser. User-shared tab audio is opt-in and has a hard 15-second recording stop; transcription is capped at 12 seconds. Audio elapsed timestamps are deliberately separated from player timestamps.

Reports, representative JPEG frames, landmarks, captions, and measurements are saved in IndexedDB in the product's own origin. Website and extension libraries are independent; there is no automatic synchronization. Raw audio is never saved in history. JSON export is Free. The detailed HTML exporter contains actual measurements and escapes user-controlled text.

## Pro boundary

The UI sends an explicit request to the optional website API. Supabase verifies the bearer session; the client cannot supply its own tier or user ID. PostgreSQL stores subscriptions populated by signed Stripe **test** webhooks. The server checks status and the current subscription period before reserving credits and worst-case model cost in a transaction. A transaction-scoped advisory lock serializes global and per-user budget checks. Duplicate request IDs and concurrent in-flight requests are rejected. Credits renew through the verified period boundary; prior ledger rows remain for audit.

After provider failure, the user credit is refunded but the cost reservation is retained because a timed-out provider may still have billed. There is no automatic cloud retry. Stale reservations fail closed and require administrator investigation. The ledger stores usage and identifiers, not reports or raw media. The configured model provider can be changed through server environment variables without rebuilding either UI. The included adapter supports OpenAI-compatible image/text chat and bounded WAV transcription. Other protocols belong in `apps/web/server/cloud.ts` behind the same boundary.

Cost guarantees depend on accurate administrator-supplied upper model prices and image-token bounds. Use provider project spending caps as a second boundary. An adapter with tools, unbounded output, long media, external URLs, or unknown pricing must add its own conservative reservation rules before enabling it. The default adapter has no tools, no arbitrary fetches from report content, bounded frames/text/output, a timeout, one concurrent request per user, and per-request, per-user, and global monthly cost limits.

## Preserved original application

The original Next.js page is under `apps/web/app/legacy`; its Python worker is under `apps/web/analysis`, with its original server modules and API routes retained. `ENABLE_LEGACY_WORKER=true` explicitly enables that self-hosted workflow. It is disabled on Netlify, where Python/FFmpeg subprocess processing is not a supported deployment assumption. The new homepage uses the shared browser engine and does not need the Python worker. Original deployment notes are preserved in `LEGACY_WEBSITE.md`.
