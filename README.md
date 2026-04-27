# IM8 Content Automation Tools

This repository contains the automation tools built for IM8's content production system. These tools were originally developed as part of a private NoaOS system. To reactivate them, you need to reconnect them to your own accounts (see Setup below).

---

## What's in Here

### 1. Editor Brief Bot (`/1-editor-brief-bot`)
Turns raw IM8 footage into structured ad-cut briefs.

**How it works:**
- Triggered by a Slack message in the IM8 briefing channel: `@NoaOS editor brief <drive-folder-url> branded|ads`
- Downloads videos from the Drive folder, transcribes each one (Whisper)
- Passes all transcripts to Claude with strict rules: verbatim-only lines, cited by timestamp, no invention
- Outputs a Google Doc with 5-10 distinct ad cut briefs, each with different length/angle/talent emphasis
- Appends a row to the "Ad Pipeline" tab in the IM8 Master Tracker Sheet
- Posts a threaded Slack reply with the Doc link

**Two modes:**
- `branded` - cinematic, polished, high-production cuts
- `ads` - performance-first, fast-cut, hook-driven direct response

**Output folder (Google Drive):** `1Um55xGVRguvLKefqHPtDO5jOW7Snso3b`
*(You'll want to change this to a folder in your own Drive)*

---

### 2. Ambassador Brief Bot (`/2-ambassador-brief-bot`)
Generates a fully personalised ambassador campaign brief for any creator.

**How it works:**
- Triggered by a multi-line Slack message in the IM8 briefing channel:
```
@NoaOS ambassador brief
focus: GLP-1 support
handle: @creatorhandle
tier: 2
code: NAME10
link: https://im8health.com/discount/NAME10
tag: @im8health
approval: First cut 5 business days after brief, approval window 3 business days
delivery: All assets by 21 days after brief
usage: Organic + paid + whitelisting, 12 months
```
- Looks up the creator in a local roster JSON file
- If not found, runs live Perplexity research to profile the creator and saves them to the roster
- Researches IM8 ingredients + clinical doses for the chosen focus area
- Builds a two-part Google Doc: internal context (Part 1, deleted before sending) + the ambassador-facing brief (Part 2)
- The brief's Reel structure is adapted to match the creator's actual content patterns, not a generic template
- Appends a row to the "Influencer Tracker" tab in the IM8 Master Tracker Sheet
- Posts a threaded Slack reply with the Doc link

**Tier system:**
- Tier 1: Reel only
- Tier 2: Reel + 1-2 Story Sets
- Tier 3: Reel + 3-4 Story Sets
- Tier 4: Full package (Reel + Stories + raw footage library)

**Output folder (Google Drive):** `17YeuFLfcXzodNeL6dRgOd_SH2x9kZ0BW`
*(Change this to a folder in your own Drive)*

---

### 3. Transcription Terminal (`/3-transcription-terminal`)
A searchable web dashboard for IM8 raw footage.

**How it works:**
- Paste a Google Drive file or folder URL into the upload view
- The pipeline downloads the video, transcribes with Whisper, diarizes speakers with AssemblyAI, generates embeddings with OpenAI, and auto-tags content categories with Claude
- Search view: free-text query returns segment-level results with timestamps
- Video detail view: click any result to embed the Drive player scrubbed to that timestamp
- Stores everything in a local SQLite database

**Status:** Work in progress. Core transcription pipeline is functional. Some UI features are incomplete.

**Deploy:** The `/3-transcription-terminal/render.yaml` blueprint deploys to Render. See the README inside for step-by-step instructions.

---

### 4. Weekly Sprint Bot (`/4-weekly-sprint-bot`)
Reads the Monday sprint message from the IM8 internal production channel and auto-generates ad briefs per ICP.

**How it works:**
- Runs on a PM2 cron every Monday at 1pm SGT
- Reads the latest `CREATIVE SPRINT` message from `#IM8-Ad-Production-Internal`
- Parses ICP codes, problem codes, and lander URLs from the message
- Runs the ad-script-brief-pipeline (competitor analysis via Foreplay + TikTok trend data) per ICP
- Posts brief outputs back to the channel

**Note:** This bot depends on the Foreplay API for competitor ad data. Make sure your Foreplay account has access to the IM8 ad library.

---

## Setup

### Step 1: Clone and install
```bash
git clone https://github.com/takhelnoa-dot/im8-content-handover.git
cd im8-content-handover
```

Each bot has its own dependencies. Install for the one(s) you want to use:
```bash
cd 1-editor-brief-bot && npm install
cd 2-ambassador-brief-bot && npm install
# etc.
```

### Step 2: Set up environment variables
```bash
cp .env.example .env
# Fill in your values - see .env.example for what each one does
```

### Step 3: Google auth
The bots use Google Drive and Google Sheets. You have two options:

**Option A - OAuth2 (local use):**
1. Go to console.cloud.google.com
2. Create a project, enable Drive API and Sheets API
3. Create OAuth2 credentials (Desktop App type)
4. Download the JSON and save as `secrets/client_secret.json`
5. Run the auth flow once to generate `secrets/token.json`:
```bash
node shared-lib/drive-helpers.js --auth
```

**Option B - Service Account (Render/cloud):**
1. Create a service account in Google Cloud Console
2. Grant it Editor access to the Drive folders and Sheets it needs
3. Download the JSON key, base64-encode it: `base64 -w 0 key.json`
4. Set as `GOOGLE_SERVICE_ACCOUNT_JSON` in your env

### Step 4: Create a Slack bot
1. Go to api.slack.com/apps and create a new app
2. Add these Bot Token Scopes: `chat:write`, `channels:history`, `files:read`, `app_mentions:read`
3. Install to your workspace
4. Copy the Bot Token into `SLACK_BOT_TOKEN`
5. Invite the bot to these channels: `#im8-ad-production-internal`, the IM8 briefing channel, and any others it needs to read from

### Step 5: Update Drive folder IDs
The scripts have hardcoded Drive folder IDs that point to the previous operator's folders. Search for `OUTPUT_FOLDER_ID` in each script and replace with your own folder IDs.

### Step 6: Update the IM8 Tracker Sheet ID
In `shared-lib/im8-tracker.js`, the `SHEET_ID` constant points to the existing IM8 Master Tracker. Update this if you're moving to a new sheet.

---

## Shared Libraries (`/shared-lib`)

| File | What it does |
|------|-------------|
| `drive-helpers.js` | Google Drive auth + file operations (upload, list, download) |
| `slack-notify.js` | Posts threaded replies to Slack channels |
| `im8-tracker.js` | Reads/writes to the IM8 Master Tracker Google Sheet |
| `transcribe.js` | Downloads a video from Drive and transcribes it with Whisper |

---

## Important Notes

- *These tools were previously connected to private accounts* (Anthropic, Foreplay, Slack, Google). All of those connections are severed. You must reconnect to your own accounts using the setup steps above.
- *The Render dashboards (transcription terminal, etc.) were on the previous operator's Render account* and are no longer active. You'll need to create your own Render account and redeploy.
- *The roster file* (`context/im8-roster/roster.json`) from the original system is not included here as it contains personal data about creators. You'll start with an empty roster - the ambassador brief bot will auto-research and build it as you use it.
- *Nothing in this repo contains API keys or credentials.* If you find any, do not commit them.
