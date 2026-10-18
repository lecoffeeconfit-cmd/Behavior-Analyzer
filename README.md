# Video Analyzer

One repository produces a **Next.js website** and a **standalone Chrome MV3 extension**, sharing the local engine, packaged models, types, React screens, icy blue design system, Free/Pro definitions, reports, and history.

Video Analyzer turns accessible video into an organized evidence workspace: annotated face/body landmarks, head/eye/brow measurements, movement maps, acoustic charts, captions, timestamped observations and searchable reports. Free runs in your browser; optional Pro uses an authenticated, metered backend.

## Install and build

Use Node 22.12+ and npm from the repository root:

```bash
npm ci
npm run assets
npm run dev:web          # localhost:3000
npm run build:web        # apps/web/.next
npm start                # production website
npm run build:extension  # dist/extension
npm run dev:extension    # rebuild/watch; no hosted frontend
npm run package:extension # release/video-analyzer-1.0.0.zip
```

Asset preparation downloads pinned Google MediaPipe models once, verifies committed SHA-256 digests, and packages the same models/WASM in both outputs. Subsequent builds reuse local files. Extension Free features require no deployment, Netlify site, public domain, account, API, subscription or runtime model download.

## Chrome installation

1. Open `chrome://extensions` in Chrome 116+, enable Developer mode, and select **Load unpacked**.
2. Choose **dist/extension**, containing `manifest.json`.
3. Pin Video Analyzer, visit an HTTP/HTTPS video page, and click its toolbar icon.
4. Choose a detected player, play it for movement observations, and select **Analyze video**.
5. Explore Overview, Signals, Transcript, Authenticity and Ask. Timestamp chips seek compatible players. Reports save automatically in Library.

Local uploads also work in the side panel. Reload the extension and target page after rebuilding. Click the toolbar icon again after navigating to a new origin to grant temporary page access. Restricted Chrome pages, inaccessible cross-origin embeds and closed shadow roots cannot be inspected.

## Website

Upload a local MP4/WebM, play it for motion, and select Analyze. CORS-enabled direct video URLs also work; social page URLs require the extension. Other formats depend on browser codecs. Free needs no environment variables, Python, FFmpeg, authentication, database server or remote AI processing. Static model/worker assets load from the website's own origin, then processing stays local.

## Implemented Free features

- Real HTML5 multi-video detection and document-aware player targeting.
- Local file analysis in both products; public CORS-enabled URL input on the website.
- Packaged MediaPipe face/pose inference, annotated frames, relative head direction, eye-line roll, brow spacing, eye/mouth openness, blink-like closures, iris position, shoulder/wrist movement and torso inclination.
- Actual pixel-change maps, large visual changes, luminance/contrast/color measurements, edge energy and 8-pixel boundary discontinuities for compression review.
- Opt-in accessible file/shared-tab audio, RMS and periodic pitch estimates. No microphone.
- Accessible HTML captions, public same-origin VTT, user VTT import, deterministic summaries and local text retrieval Q&A.
- IndexedDB history, search/delete, charts, clickable timestamps and JSON export.
- Local file metadata and sampled container provenance-marker inspection, with no signature validation.

Observation is a still frame or up to 12 seconds at approximately 4 fps, **not a full-video forensic scan**. Paused players yield still-frame reports. Brief blinks/micro-movements can be missed. Face slots are spatial, not identity tracking across cuts/crossings. Audio elapsed time is separated from player time. DRM/CORS failures produce partial reports and clear notes; no restriction bypass is attempted.

**No validated deepfake classifier is included, so no AI-generation percentage is invented.** Facial spacing, compression and lighting cues are evidence to review, not proof of authenticity. There are no truthfulness, trust, fear, emotion, intention or relationship scores. Brightness does not establish capture time or time of day. MediaPipe is the implemented local runtime; ONNX/Transformers/OpenCV are not claimed as installed features without actual working models.

## Optional Pro

Default price: **$2.99/month**, configurable server-side. Pro supports cloud image/text explanations and questions, comparisons of up to three reports, bounded audio transcription, detailed HTML reports and a monthly allowance. The default adapter does not run validated deepfake or AV-synchronization models.

The server verifies Supabase sessions and Stripe subscription records in PostgreSQL. It atomically reserves credits and conservative cost before model calls, limits request/image/audio/output size, rejects duplicates and concurrent requests, and enforces user/global budgets. Failed calls refund credits but retain uncertain cost reservations. Provider/model and limits are server settings, with no browser-bundled shared secrets.

**Live billing is disabled. No external billing/account/database/model service is configured automatically.** Stripe source is test-only and refuses live keys/events. The UI has no purchase button suggesting billing is already ready. Follow [billing phase two](docs/BILLING_PHASE_2.md) for the separate staging integration and verification phase.

For staging, configure `apps/web/.env.example`, apply `apps/web/server/schema.sql`, and provision authentication, exact allowed origins, server-only keys and conservative model prices/caps. The extension's Pro account screen accepts your backend URL and requests optional permission for that host. Free works if the backend fails. Session tokens are temporary; no refresh token is persisted.

## GitHub and Netlify

Keep the existing repository, Netlify connection and production branch. No commits, pushes, remote account settings or deployments are performed automatically.

| Setting | Value |
| --- | --- |
| Base directory | Repository root (`.`) |
| Package directory | `apps/web` |
| Build command | `npm run build:web` |
| Publish directory | `apps/web/.next` |
| Node | 22 |

The root `netlify.toml` supplies build/publish configuration. **Package directory is set in Netlify's UI**: use `apps/web` so its current Next.js adapter locates the app while npm installs root workspaces. `npm run build` remains a website compatibility alias. Never publish the extension directory as the website or expose secrets via `NEXT_PUBLIC_` variables.

References: [Netlify monorepos](https://docs.netlify.com/build/configure-builds/monorepos/), [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/). No live deployment/account configuration is claimed verified.

## Verification and store packaging

```bash
npm run assets
npm run worker:web
npm run typecheck
npm run lint
npm test
npm run build:web
npm run build:extension
npx playwright install chromium
npm run test:e2e
node scripts/package.mjs
```

Tests cover measurements, pitch, VTT, partial results, truthful limitations, local history, export escaping, authentication/CORS, Stripe signatures, bounded cloud/audio requests and real SQL usage accounting. Embedded PostgreSQL tests exercise concurrency, duplicate requests, renewal, failure accounting and exhausted allowances.

Chromium tests cover real local upload/model inference, responsive reports, persistent history, unpacked MV3 loading, Side Panel API, multiple players, captions, capture, seeking and restriction handling. Automation uses a temporary localhost-only host grant in a test copy of the manifest. The shipped manifest uses `activeTab`; manually verify the real toolbar gesture before release. Screenshots go to `artifacts/qa`.

The store ZIP has `manifest.json` at its root, generated PNG icons (16/32/48/128), production JS/CSS, models and WASM. Before submission, inspect the exact ZIP and complete the listing, screenshots, support contact, published privacy policy and data disclosures. No store submission occurs automatically. GitHub Actions verifies both outputs and uploads the extension package/screenshots.

## Layout and original code

- `apps/web`: Next.js website and optional secure Pro API.
- `apps/extension`: Chrome adapter, content script and background worker.
- `packages/analysis`: capture, local models, measurements and reports.
- `packages/shared`: common types, plans, storage and cloud client.
- `packages/ui`: shared screens, charts and design system.

The original page/styles/Python worker/server routes are preserved in `apps/web`, with the original UI at `/legacy`. That self-hosted workflow requires `ENABLE_LEGACY_WORKER=true`, Python dependencies and FFmpeg; it is disabled on Netlify. See [original notes](LEGACY_WEBSITE.md), [architecture](docs/ARCHITECTURE.md), [privacy](docs/PRIVACY.md) and [model attribution](docs/MODELS.md).
