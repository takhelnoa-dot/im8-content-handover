# IM8 Transcription Terminal

Searchable library of IM8 raw footage. Paste a Drive link, auto-transcribe + diarize + auto-tag, search semantically, scrub Drive iframe to the matched timestamp.

## Local dev

```
cp .env.example .env
# Fill in DASHBOARD_PASSWORD, OPENAI_API_KEY, ASSEMBLYAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, TERMINAL_UPLOAD_DRIVE_FOLDER_ID
npm install
npm run dev
```

Open http://localhost:3006 and log in with DASHBOARD_PASSWORD.

## Deploy to Render

This service uses a `render.yaml` blueprint. On first deploy:

1. Create a Google Cloud service account. Grant it access to the Google Drive API. Download the JSON key and `base64 -w 0 key.json` to get a one-line string. Put that in the Render env var `GOOGLE_SERVICE_ACCOUNT_JSON`.
2. Share every Drive folder you want the terminal to read from (and the target upload folder) with the service account's email address.
3. Create a Drive folder for direct MP4 uploads. Set its ID in `TERMINAL_UPLOAD_DRIVE_FOLDER_ID`.
4. Set `DASHBOARD_PASSWORD` (single shared login), `OPENAI_API_KEY` (Whisper + embeddings), `ASSEMBLYAI_API_KEY` (diarization), `ANTHROPIC_API_KEY` (auto-tagging).
5. Render auto-provisions a 10GB persistent disk at `/data` for the SQLite file + thumbnails.

## Architecture

See `docs/superpowers/specs/2026-04-20-transcription-terminal-design.md` in the repo root.

## Workflow

1. Upload view: paste a Drive file or folder URL. Pick videos to ingest.
2. Pipeline runs: download, Whisper transcribe, AssemblyAI diarize, embed with OpenAI, auto-tag with Claude.
3. Search view: free-text query returns segment-level results with timestamps. Filter by speaker or category.
4. Video detail: click any result to embed the Drive player with the matched timestamp shown for manual scrub.

## Endpoints

- `GET  /healthz` - public health check
- `POST /login` - sign in with DASHBOARD_PASSWORD
- `POST /logout`
- `POST /api/upload/inspect` - inspect a Drive URL (file or folder)
- `POST /api/upload/ingest` - queue videos by fileId
- `POST /api/upload/file` - direct MP4 upload (uploads to Drive first)
- `GET  /api/upload/queue` - live queue snapshot
- `POST /api/upload/retry/:videoId`
- `GET  /api/search?q=&speakers=&categories=&limit=&offset=`
- `GET  /api/videos`
- `GET  /api/videos/:id`
- `PATCH /api/videos/:id`
- `PATCH /api/videos/:videoId/segments/:segmentId`
- `POST /api/videos/:id/retag`
- `DELETE /api/videos/:id`
- `GET  /api/speakers`
- `POST /api/speakers`
- `PATCH /api/speakers/:id`
- `POST /api/speakers/merge`
- `GET  /api/categories`
- `POST /api/categories`
- `PATCH /api/categories/:id`
- `POST /api/categories/:id/promote`
- `POST /api/categories/:id/reject`
- `POST /api/categories/retag-all`
- `GET  /api/saved-searches`
- `POST /api/saved-searches`
- `DELETE /api/saved-searches/:id`
- `GET  /api/settings`

## Port

Local: 3006 (default). Matches pattern: blog 3003, caller 3004, HookFactory 3005.
