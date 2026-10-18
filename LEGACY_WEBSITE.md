# Behavior Analyzer

Preserved original notes. The original UI is now at `apps/web/app/legacy` and `/legacy`, with its worker in `apps/web/analysis`. Use the browser-local homepage for normal website/extension use. To enable the older self-hosted workflow, install Python dependencies and FFmpeg, set an absolute `PYTHON_BIN` and `ENABLE_LEGACY_WORKER=true` in `apps/web/.env.local`, and run `npm run dev:web` from the repository root. Relative commands below describe the former layout.

Behavior Analyzer is a self-hosted Next.js + Python MVP for reviewing measurable changes across face, eyes, voice, movement, and speech. It uses temporary local storage only: there is no database, account history, external AI API, or permanent report storage.

## Local development

```bash
npm install
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. FFmpeg must be installed and available as `ffmpeg` / `ffprobe`.

## Production checks

```bash
npm run lint
npx tsc --noEmit
npm run build
docker build -t behavior-analyzer .
docker run --rm -p 3000:3000 --env-file .env.example behavior-analyzer
curl http://localhost:3000/api/health
```

## Coolify

Use the repository Dockerfile. Set the exposed/public port to `3000`, enable HTTPS, and add the variables from `.env.example` as Coolify environment variables. Keep `/tmp` writable inside the container. A persistent volume is not required for the MVP because jobs are intentionally temporary.

The Python worker runs locally inside the container. `faster-whisper` downloads the selected local model on first use; this is a model artifact, not a paid AI API. If no model can be downloaded, the rest of the report still completes and the transcript is empty.

The analysis is intentionally cautious: signal changes are timestamped and compared with an earlier baseline, but they do not establish deception, honesty, intent, emotion, or mental state.
