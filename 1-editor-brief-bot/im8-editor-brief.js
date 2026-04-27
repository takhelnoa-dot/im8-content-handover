// im8-editor-brief.js
//
// IM8 ad-cut editor-brief pipeline. Triggered by Slack mention via slack-bot:
//   @NoaOS editor brief <drive-folder-link> branded|ads
//
// Flow:
//   1. Resolve folder ID from the Drive URL
//   2. List all video files in that folder
//   3. Download + transcribe each (Whisper) -> label T1/T2/T3 with line numbers
//   4. Load shared rules + brand rules + style prompt + few-shot example
//   5. Call Claude (Sonnet 4, 16k tokens) to generate 5-10 distinct cuts
//   6. Validate every "VERBATIM TRANSCRIPT LINE" exists in source
//   7. Upload the resulting Google Doc to Drive folder OUTPUT_FOLDER_ID
//   8. Append rows to the April Ad Pipeline 2026 sheet (one per cut)
//   9. Post threaded reply in Slack with cut count + Doc link
//
// Exposes runEditorBrief(...) for direct invocation by the Slack bot.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { getDrive, downloadFile, listFiles, uploadGoogleDoc } = require('./drive-helpers');
const { transcribeVideo } = require('./lib/transcribe');
const { sendSlackThread } = require('./lib/slack-notify');
const { appendAdCutRow, getLastResolveFallback } = require('./lib/im8-tracker');

const OUTPUT_FOLDER_ID = '1Um55xGVRguvLKefqHPtDO5jOW7Snso3b';
const TEMP_DIR = path.join(os.tmpdir(), 'noaos-im8-editor-brief');
const SKILL_DIR = path.join(__dirname, '../../.claude/skills/im8-editor-brief');
const EXAMPLE_PATH = path.join(__dirname, '../../references/examples/im8-ad-cut-briefs-example.md');

function log(msg) { console.log(`[im8-editor-brief] ${new Date().toISOString().slice(11, 19)} ${msg}`); }

function parseDriveFolderId(url) {
  const m = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error(`Could not parse folder ID from: ${url}`);
  return m[1];
}

async function getFolderName(drive, folderId) {
  const res = await drive.files.get({ fileId: folderId, fields: 'name' });
  return res.data.name;
}

// Add stable line numbers to a Whisper transcript so the brief can cite them.
// We split the FULL TEXT into roughly-sentence lines (one per ~80 chars or
// sentence boundary, whichever comes first), starting at L1.
function numberTranscript(text, transcriptLabel /* T1, T2... */) {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"])/);
  const lines = [];
  let lineNum = 1;
  for (const s of sentences) {
    // Wrap long sentences across multiple lines so no line exceeds ~120 chars
    if (s.length <= 120) {
      lines.push({ n: lineNum++, text: s });
    } else {
      const chunks = s.match(/.{1,120}(\s|$)/g) || [s];
      for (const c of chunks) {
        lines.push({ n: lineNum++, text: c.trim() });
      }
    }
  }
  const formatted = lines.map(l => `L${l.n}: ${l.text}`).join('\n');
  return {
    label: transcriptLabel,
    lineCount: lines.length,
    formatted: `=== ${transcriptLabel} (${lines.length} lines) ===\n${formatted}`,
    raw: text,
    lines,
  };
}

async function callClaude(prompt, { maxTokens = 16000, model = 'claude-sonnet-4-20250514' } = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        const req = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        }, res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            if (res.statusCode === 429 || res.statusCode >= 500) {
              return reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) return reject(new Error(`Claude: ${parsed.error.message}`));
              resolve(parsed.content?.[0]?.text || '');
            } catch (e) { reject(new Error(`Claude parse: ${e.message}`)); }
          });
        });
        req.on('error', reject);
        req.setTimeout(180000, () => { req.destroy(); reject(new Error('Claude timeout')); });
        req.write(payload);
        req.end();
      });
    } catch (err) {
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        log(`Claude attempt ${attempt} failed (${err.message}), retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else throw err;
    }
  }
}

function loadSkillFiles(briefType) {
  const sharedRules = fs.readFileSync(path.join(SKILL_DIR, 'shared-rules.md'), 'utf8');
  const brandRules = fs.readFileSync(path.join(SKILL_DIR, 'brand-rules/im8.md'), 'utf8');
  const styleFile = briefType === 'branded' ? 'high-end-branded.md' : 'ads.md';
  const stylePrompt = fs.readFileSync(path.join(SKILL_DIR, 'prompts', styleFile), 'utf8');
  const example = fs.readFileSync(EXAMPLE_PATH, 'utf8');
  return { sharedRules, brandRules, stylePrompt, example };
}

function buildPrompt({ briefType, folderName, transcripts, sharedRules, brandRules, stylePrompt, example }) {
  const transcriptBundle = transcripts.map(t => t.formatted).join('\n\n');
  const totalLines = transcripts.reduce((sum, t) => sum + t.lineCount, 0);
  const cutCountGuidance = totalLines < 200 ? '5-6'
                          : totalLines < 500 ? '6-8'
                          : '8-10';

  return `You are generating an IM8 editor-brief document containing multiple ad-cut briefs from raw footage transcripts.

# Mode

briefType: **${briefType}** (${briefType === 'branded' ? 'high-end / cinematic / polished' : 'performance / fast-cut / direct response'})

# Source

Folder name: ${folderName}
Transcripts: ${transcripts.length} (${transcripts.map(t => t.label).join(', ')})
Total transcript lines: ${totalLines}
Target cut count: **${cutCountGuidance}**

# Rules to follow strictly

## Shared rules (apply to ALL cuts)

${sharedRules}

## Brand rules (IM8)

${brandRules}

## Mode rules (${briefType})

${stylePrompt}

# Reference output format (match this structure exactly)

Below is a previously-shipped IM8 ad-cut brief document. Match its formatting, header structure, table layout, citation style, and tone.

\`\`\`
${example}
\`\`\`

# Source transcripts (cite from these only)

${transcriptBundle}

# Your task

Generate a complete IM8 ad-cut brief document containing ${cutCountGuidance} distinct cuts, following the format of the reference example exactly.

Open with the master header (folder name, today's date, total brief count, base length range), then output every cut in sequence.

Critical reminders:
- Every "VERBATIM TRANSCRIPT LINE" must be exact text from the supplied transcripts
- Every line cited as Tn · Lx-y referring to actual line numbers above
- B-roll directives match the ${briefType} mode vocabulary
- Exclude IM8 instant-impact lines (use [NOTE] when needed)
- No two cuts pull the same line set
- Use [GAP] for any beat that genuinely cannot be filled

Output the entire document as markdown, ready to save as a Google Doc. Do not wrap in code fences. Begin immediately with the master header.`;
}

// Validate every VERBATIM TRANSCRIPT LINE exists in source.
// Returns { valid: bool, issues: [...] }
function validateTranscriptLines(briefDoc, transcripts) {
  const allText = transcripts.map(t => t.raw).join('\n').replace(/\s+/g, ' ').toLowerCase();
  const issues = [];
  // Match lines of the form: | SPEAKER | "..." | *Tn · Lx-y* |
  // The verbatim text is between the second pipe pair, often quoted.
  const tableRowRegex = /\|\s*(\*\*)?([A-Z][A-Z. ]+)(\*\*)?\s*\|\s*(?:\*?)["“]([\s\S]+?)["”](?:\*?)\s*\|\s*\*?T\d+\s*·\s*L/g;
  let m;
  let checked = 0;
  while ((m = tableRowRegex.exec(briefDoc)) !== null) {
    const quoted = m[4].trim().replace(/\s+/g, ' ').toLowerCase();
    checked++;
    // Substring check: at least the first ~40 chars should appear verbatim
    const probe = quoted.slice(0, 40);
    if (probe.length < 10) continue;
    if (!allText.includes(probe)) {
      issues.push(`Speaker ${m[2].trim()}: not found in transcripts: "${quoted.slice(0, 80)}..."`);
    }
  }
  return { valid: issues.length === 0, issues, checked };
}

function extractCutTitles(briefDoc) {
  // Match table rows like: | BRIEF 01 — WORLD CLASS |
  const titles = [];
  const re = /\|\s*BRIEF\s+(\d+)\s*[—\-–]\s*([A-Z][A-Z .,'!&\-]+?)\s*\|/g;
  let m;
  while ((m = re.exec(briefDoc)) !== null) {
    titles.push({ num: m[1], title: m[2].trim() });
  }
  return titles;
}

async function runEditorBrief({ driveFolderUrl, briefType, slackChannel, threadTs }) {
  if (!['branded', 'ads'].includes(briefType)) {
    throw new Error(`briefType must be "branded" or "ads", got: ${briefType}`);
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const folderId = parseDriveFolderId(driveFolderUrl);
  const drive = getDrive();
  const folderName = await getFolderName(drive, folderId);
  log(`Source folder: ${folderName} (${folderId})`);

  // 1. List video files
  const files = await listFiles(drive, folderId, ['video/']);
  if (files.length === 0) {
    throw new Error(`No video files found in folder ${folderName}`);
  }
  log(`Found ${files.length} video file(s)`);

  // 2. Download + transcribe each
  const transcripts = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const label = `T${i + 1}`;
    const tempPath = path.join(TEMP_DIR, `${label}_${f.id}_${f.name}`);
    log(`Downloading ${f.name}...`);
    await downloadFile(drive, f.id, tempPath);
    log(`Transcribing ${f.name} as ${label}...`);
    const result = await transcribeVideo(tempPath, f.id, TEMP_DIR);
    fs.unlinkSync(tempPath);
    const numbered = numberTranscript(result.text || '', label);
    numbered.fileName = f.name;
    numbered.fileId = f.id;
    transcripts.push(numbered);
    log(`  ${label}: ${numbered.lineCount} lines`);
  }

  // 3. Load skill files + build prompt
  const skill = loadSkillFiles(briefType);
  const prompt = buildPrompt({ briefType, folderName, transcripts, ...skill });
  log(`Calling Claude (Sonnet 4) — prompt size: ${Math.round(prompt.length / 1000)}K chars`);

  // 4. Generate brief
  const briefDoc = await callClaude(prompt, { maxTokens: 16000 });
  log(`Generated ${Math.round(briefDoc.length / 1000)}K chars`);

  // 5. Validate transcript lines
  const validation = validateTranscriptLines(briefDoc, transcripts);
  log(`Validation: ${validation.checked} lines checked, ${validation.issues.length} issues`);
  if (validation.issues.length > 0) {
    log(`First 3 issues: ${validation.issues.slice(0, 3).join('; ')}`);
  }

  // 6. Upload to Drive
  const dateStr = new Date().toISOString().slice(0, 10);
  const cleanFolder = folderName.replace(/[^a-zA-Z0-9 ·.,&'-]/g, '').slice(0, 80);
  const docName = `IM8 x ${cleanFolder} - ${dateStr}`;
  log(`Uploading Google Doc: ${docName}`);
  const doc = await uploadGoogleDoc(drive, OUTPUT_FOLDER_ID, docName, briefDoc);
  log(`Doc created: ${doc.webViewLink}`);

  // 7. Append rows to Ad Pipeline sheet — one per cut
  const cuts = extractCutTitles(briefDoc);
  log(`Detected ${cuts.length} cuts; appending rows to Ad Pipeline sheet`);
  const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  let rowsWritten = 0;
  let sheetTab = '';
  for (const cut of cuts) {
    try {
      const adType = briefType === 'branded' ? 'KOLTH' : 'TALKH';
      const persona = 'AMB';
      const adName = `${yymmdd}_VID_${adType}_AMB_${cut.title.replace(/[^A-Z0-9]/g, '').slice(0, 20)}_C${cut.num}_INT_AUTO_NA_NA_NA_NA_PDP*`;
      const result = await appendAdCutRow({
        name: adName,
        scriptConceptLink: doc.webViewLink,
        conceptDescription: `Cut #${cut.num} — ${cut.title}`,
        problem: 'AMB',
        persona,
        comments: `Generated from ${folderName} (${transcripts.length} source videos, ${briefType} mode)`,
        editingStyle: briefType === 'branded' ? 'Branded / Cinematic' : 'Performance / Fast-cut',
        videoCount: '1',
        yymmdd,
      });
      sheetTab = result.tab;
      rowsWritten++;
    } catch (e) {
      log(`  WARN: failed to append cut ${cut.num}: ${e.message}`);
    }
  }
  log(`Wrote ${rowsWritten}/${cuts.length} rows to "${sheetTab}"`);

  // 8. Slack reply
  if (slackChannel && threadTs) {
    const fallback = getLastResolveFallback();
    const fallbackLine = fallback
      ? `:rotating_light: *Heads up:* current-month tab \`${fallback.expected}\` doesn't exist yet. Wrote to \`${fallback.used}\` as fallback. Create the new month's tab when ready.`
      : null;
    const msg = [
      `*IM8 editor brief ready* — ${briefType} mode`,
      `Source: \`${folderName}\` (${transcripts.length} videos, ${transcripts.reduce((s, t) => s + t.lineCount, 0)} transcript lines)`,
      `Cuts: *${cuts.length}* generated`,
      validation.issues.length > 0 ? `:warning: ${validation.issues.length} verbatim-validation warnings (review the Doc)` : `:white_check_mark: All transcript citations validated`,
      `Sheet rows added: ${rowsWritten}/${cuts.length} to *${sheetTab}*`,
      fallbackLine,
      `Doc: ${doc.webViewLink}`,
    ].filter(Boolean).join('\n');
    await sendSlackThread(slackChannel, threadTs, msg);
  }

  return {
    docUrl: doc.webViewLink,
    docName,
    cutCount: cuts.length,
    transcriptCount: transcripts.length,
    validation,
    sheetTab,
    rowsWritten,
  };
}

// CLI: node im8-editor-brief.js <drive-url> <branded|ads> [slack-channel] [thread-ts]
if (require.main === module) {
  const [url, type, slackChannel, threadTs] = process.argv.slice(2);
  if (!url || !type) {
    console.error('Usage: node im8-editor-brief.js <drive-folder-url> <branded|ads> [slack-channel] [thread-ts]');
    process.exit(1);
  }
  runEditorBrief({ driveFolderUrl: url, briefType: type, slackChannel, threadTs })
    .then(r => { console.log('OK:', r); process.exit(0); })
    .catch(async e => {
      console.error('FAIL:', e);
      // Notify the slack thread so the user isn't left wondering
      if (slackChannel && threadTs) {
        try { await sendSlackThread(slackChannel, threadTs, `:x: editor brief failed: ${e.message}`); } catch {}
      }
      process.exit(1);
    });
}

module.exports = { runEditorBrief };
