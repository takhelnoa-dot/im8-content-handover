// im8-ambassador-brief.js
//
// IM8 ambassador-brief pipeline. Triggered by Slack mention via slack-bot:
//   @NoaOS ambassador brief
//   focus: ...
//   handle: ...
//   tier: 1|2|3|4
//   code: ...
//   link: ...
//   tag: @im8health
//   approval: ...
//   delivery: ...
//   usage: ...
//
// Flow:
//   1. Parse multi-line `field: value` mention text
//   2. Validate; ask for missing fields in-thread if any
//   3. Roster lookup (context/im8-roster/roster.json) by name OR handle
//   4. If not found -> auto-discovery (research-im8-roster.js --add) + sheet append
//   5. IM8 ingredient research for the focus area (Perplexity, im8health.com)
//   6. Build prompt: template + roster entry + ingredient data + reel-structure rules + inputs
//   7. Call Claude (Sonnet 4) -> full two-part document
//   8. Upload Google Doc to Drive folder OUTPUT_FOLDER_ID
//   9. Append row to current "Influencer Tracker" tab
//  10. Post threaded reply with Doc link
//
// Exposes runAmbassadorBrief(...) for direct invocation by the Slack bot.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { getDrive, uploadGoogleDoc } = require('./drive-helpers');
const { sendSlackThread } = require('./lib/slack-notify');
const { appendInfluencerRow, upsertInfluencerBrief, getLastResolveFallback } = require('./lib/im8-tracker');

const OUTPUT_FOLDER_ID = '17YeuFLfcXzodNeL6dRgOd_SH2x9kZ0BW';
const SKILL_DIR = path.join(__dirname, '../../.claude/skills/im8-ambassador-brief');
const ROSTER_PATH = path.join(__dirname, '../../context/im8-roster/roster.json');

function log(msg) { console.log(`[im8-ambassador-brief] ${new Date().toISOString().slice(11, 19)} ${msg}`); }

const REQUIRED_FIELDS = ['focus', 'handle', 'tier', 'code', 'link', 'approval', 'delivery', 'usage'];
const OPTIONAL_FIELDS = ['reference', 'tag', 'name'];

// Parse multi-line "field: value" mention text. Lines that don't match the
// pattern are joined into the prior field's value (lets the user write multi-line
// notes for delivery / approval / etc).
function parseInputs(text) {
  const cleaned = text.replace(/<@[^>]+>/g, '').trim();
  const lines = cleaned.split(/\n/);
  const inputs = {};
  let lastKey = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { lastKey = null; continue; }
    const m = line.match(/^([a-zA-Z]+)\s*[:=]\s*(.+)$/);
    if (m && [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].includes(m[1].toLowerCase())) {
      lastKey = m[1].toLowerCase();
      inputs[lastKey] = m[2].trim();
    } else if (lastKey) {
      inputs[lastKey] += ' ' + line;
    }
  }
  return inputs;
}

function missingFields(inputs) {
  return REQUIRED_FIELDS.filter(f => !inputs[f]);
}

// ── Roster lookup + auto-discovery ─────────────────────────────────────────────
function loadRoster() {
  if (!fs.existsSync(ROSTER_PATH)) return { ambassadors: [] };
  return JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
}

function normaliseHandle(h) {
  if (!h) return '';
  return h.toLowerCase()
    .replace(/^https?:\/\/(www\.)?(instagram|tiktok|youtube)\.com\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .trim();
}

function findInRoster(roster, { name, handle }) {
  const handleNorm = normaliseHandle(handle);
  const nameNorm = (name || '').toLowerCase().trim();
  for (const a of roster.ambassadors) {
    const aName = (a.name || '').toLowerCase();
    const aHandle = normaliseHandle(a.research?.primaryHandle || a.handle || '');
    if (handleNorm && aHandle && aHandle === handleNorm) return a;
    if (nameNorm && aName === nameNorm) return a;
    // Fuzzy: name contains
    if (nameNorm && aName.includes(nameNorm)) return a;
    if (handleNorm && aName.includes(handleNorm.replace(/\./g, ''))) return a;
  }
  return null;
}

// Best-guess type from handle context — purely heuristic. Operator can correct in sheet later.
function guessType(handle, name) {
  const lower = (handle + ' ' + (name || '')).toLowerCase();
  if (lower.includes('dr.') || lower.includes(' md ') || lower.includes('doctor')) return 'Doctors';
  if (lower.includes('nutrit') || lower.includes('rd ')) return 'Nutritionist';
  if (lower.includes('biohack') || lower.includes('longevity')) return 'Biohackers';
  return 'Athletes/Fitness';
}

async function autoDiscoverAndAdd({ name, handle, focus }) {
  const inferredName = name || handle.split('/').filter(Boolean).pop().replace(/^@/, '');
  const type = guessType(handle, inferredName);
  log(`Auto-discovery: researching new ambassador ${inferredName} (${handle})...`);

  // Run research script in --add mode
  const cmd = [
    'node',
    path.join(__dirname, 'research-im8-roster.js'),
    '--add', JSON.stringify(inferredName),
    '--handle', JSON.stringify(handle),
    '--type', JSON.stringify(type),
    focus ? `--notes ${JSON.stringify(focus)}` : '',
  ].filter(Boolean).join(' ');
  try {
    execSync(cmd, { cwd: __dirname, stdio: 'pipe', timeout: 90000 });
  } catch (e) {
    log(`research script failed: ${e.message}`);
    // continue anyway — we'll persist a stub
  }

  // Append to influencer tracker sheet
  try {
    await appendInfluencerRow({
      type,
      creatorName: inferredName,
      conceptsPerMonth: '',
      briefStatus: 'Auto Briefed',
      directionalNotes: focus || '',
      scriptConceptsLink: '',
      comments: `Auto-added via NoaOS bot - handle: ${handle}`,
      pic: 'Noa',
      currentStatus: 'Briefed',
      uploaded: 'FALSE',
      format: 'VID',
      creativeNumber: '1',
      batchname: 'INT',
      creatorNameCode: inferredName.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      creatorType: type === 'Doctors' ? 'DOC' : type === 'Nutritionist' ? 'NUTR' : type === 'Biohackers' ? 'BIO' : 'ATH',
    });
  } catch (e) {
    log(`sheet append failed: ${e.message}`);
  }

  // Re-load roster to get the freshly-researched entry
  const roster = loadRoster();
  return findInRoster(roster, { name: inferredName, handle });
}

// ── IM8 ingredient research ────────────────────────────────────────────────────
async function callPerplexity(query, { maxTokens = 2500, searchDomainFilter = [] } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'sonar',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'You are a market research analyst. Be precise. Only report what you find in public sources. Never fabricate doses or claims.' },
        { role: 'user', content: query },
      ],
      ...(searchDomainFilter.length > 0 ? { search_domain_filter: searchDomainFilter } : {}),
    });
    const req = https.request({
      hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve({ text: parsed.choices?.[0]?.message?.content || '', citations: parsed.citations || [] });
        } catch (e) { reject(new Error(`Perplexity parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Perplexity timeout')); });
    req.write(body);
    req.end();
  });
}

async function researchIngredients(focus) {
  const prompt = `Research the IM8 supplement product line at im8health.com. I am building an ambassador brief focused on: "${focus}".

Identify the IM8 ingredients (from the Daily Ultimate Essentials and any other IM8 SKUs) that are clinically relevant to "${focus}". For each ingredient, return:
- ingredient name
- clinical dose present in the IM8 product (mg or other unit, exactly as listed on im8health.com or official IM8 materials, or "dose not publicly disclosed")
- one-sentence why this ingredient matters for "${focus}" in plain English

Also list the universal IM8 anchors (90+ ingredients, NSF Certified for Sport, Mayo Clinic Ventures partnership, NASA scientists, no proprietary blend, Daily Ultimate Essentials clinical study results).

Output as a JSON object with keys: focusArea, focusSpecificIngredients[], universalAnchors[], notes. Do NOT invent doses.`;
  try {
    const { text } = await callPerplexity(prompt, { searchDomainFilter: ['im8health.com'] });
    return text;
  } catch (e) {
    log(`Ingredient research failed: ${e.message}`);
    return `(ingredient research unavailable: ${e.message})`;
  }
}

// ── Claude generation ──────────────────────────────────────────────────────────
async function callClaude(prompt, { maxTokens = 8000, model = 'claude-sonnet-4-20250514' } = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const payload = JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
        const req = https.request({
          hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
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
            if (res.statusCode === 429 || res.statusCode >= 500) return reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
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
        log(`Claude attempt ${attempt} failed (${err.message}), retry in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else throw err;
    }
  }
}

function loadSkillFiles() {
  return {
    template: fs.readFileSync(path.join(SKILL_DIR, 'template.md'), 'utf8'),
    reelStructure: fs.readFileSync(path.join(SKILL_DIR, 'reel-structure-prompt.md'), 'utf8'),
    freeIdeaBlurb: fs.readFileSync(path.join(SKILL_DIR, 'free-idea-blurb.md'), 'utf8'),
  };
}

// Strip Part 1 (the internal section) from Claude's output. The template
// divides with two consecutive horizontal rules ("---\n---") right before the
// Part 2 heading. Everything before that divider is internal prep work that
// must not reach the ambassador's team.
function stripInternalSection(doc) {
  // Match "---" then optional whitespace/newlines then "---" — this is the
  // transition from Part 1 to Part 2. Keep everything after it.
  const dividerMatch = doc.match(/\n-{3,}\s*\n-{3,}\s*\n/);
  if (dividerMatch) {
    const after = doc.slice(dividerMatch.index + dividerMatch[0].length).trimStart();
    return after;
  }
  // Fallback: if Claude labeled Part 2 explicitly, split on its heading
  const part2Match = doc.match(/^#\s*IM8\s*[×x×]\s*/m);
  if (part2Match) return doc.slice(part2Match.index);
  // Last resort: return as-is but log that stripping didn't find a divider
  log('WARN: could not find Part 1/Part 2 divider — Doc saved with full content. Review prompt.');
  return doc;
}

function buildPrompt({ inputs, rosterEntry, ingredientResearch, template, reelStructure, freeIdeaBlurb }) {
  const research = rosterEntry?.research || {};
  const tier = String(inputs.tier || '').trim();
  const tierGuide = ({
    '1': 'Tier 1 — Reel ONLY. Delete the IG STORY SETS and RAW FOOTAGE PACKAGE sections entirely.',
    '2': 'Tier 2 — Reel + 1-2 Story Sets. Keep STORY SET 1 (and optionally STORY SET 2). Delete STORY SET 3, STORY SET 4, and the RAW FOOTAGE PACKAGE section.',
    '3': 'Tier 3 — Reel + 3-4 Story Sets. Keep STORY SET 1, 2, 3 (and optionally 4). Delete RAW FOOTAGE PACKAGE.',
    '4': 'Tier 4 — Full Package. Keep all sections including RAW FOOTAGE PACKAGE.',
  })[tier] || `Custom tier — generate the exact deliverables described in the "deliverables" input below. If the deliverables describe multiple reels and/or stories with distinct focuses, output one separate DELIVERABLE section per item (e.g. "DELIVERABLE — IG REEL 1 (focus: X)", "DELIVERABLE — IG REEL 2 (focus: Y)").`;

  return `You are generating an IM8 Ambassador Brief by adapting the master template to a specific creator.

# Inputs

- focus: ${inputs.focus}
- ambassador name: ${rosterEntry?.name || inputs.name || 'unknown'}
- handle: ${inputs.handle}
- tier: ${tier} (${tierGuide})
- discount code (TRACKING ONLY — DO NOT embed in the output brief): ${inputs.code}
- discount link (TRACKING ONLY — DO NOT embed in the output brief): ${inputs.link}
- tag: ${inputs.tag || '@im8health'}
- approval: ${inputs.approval}
- delivery: ${inputs.delivery}
- usage: ${inputs.usage}
- reference video: ${inputs.reference || '(none provided)'}

# Ambassador research (from roster — verified public data)

\`\`\`json
${JSON.stringify(research, null, 2).slice(0, 6000)}
\`\`\`

# IM8 ingredient research (focus area: ${inputs.focus})

${ingredientResearch}

# Reel structure adaptation rules

${reelStructure}

# Master template (verbatim — use as the structural source of truth)

${template}

# Your task

Generate the COMPLETE ambassador brief document in markdown — Part 1 (internal) AND Part 2 (ambassador-facing) — by adapting the master template above.

Critical:
1. Fill EVERY \`[PLACEHOLDER]\` with content tailored to this ambassador's voice and the chosen focus area
2. Adapt the Reel "Suggested Structure" to mirror this ambassador's actual best-performing video flow (from contentStyle research)
3. **NEVER write the literal discount code or discount link in the brief.** The ads team supplies the code/link to the ambassador directly, separate from this brief. Anywhere the template references the code or link (Quick Reference, CTA sections, Story Set frames, etc.), write phrases like *"your discount code"*, *"the discount code provided by the ads team"*, or *"link in bio"* instead. This avoids any chance of an incorrect code making it into the brief. The code/link in the inputs above are for internal tracking only.
4. Auto-fill tags, deadlines, and usage rights from inputs above (these ARE safe to embed)
5. Apply tier rules: ${tierGuide}
6. **MULTI-FOCUS DELIVERABLES.** If the focus or deliverables input describes multiple reels or stories with *distinct* focuses (e.g. "Reel 1 = GLP-1, Reel 2 = Performance optimization" or "focus on bioavailability for reel 1, nutrition for reel 2, and 2 free ideas"), output a SEPARATE deliverable section for each. Do not merge them. Structure:
    - \`# DELIVERABLE — IG REEL 1 — <focus>\`
    - \`# DELIVERABLE — IG REEL 2 — <focus>\`
    - \`# DELIVERABLE — IG STORY SET 1 — <focus>\` (etc.)
   Each reel gets its own hooks, structure, and IM8 reveal tailored to its focus. Stories mirror their paired reel's focus (different format, same topic) unless specified otherwise.
7. **FREE IDEAS.** If any deliverable is described as "free idea", "creator's choice", "come up with it yourself", or similar, do NOT write prescribed content for that deliverable. Use this exact blurb inside the deliverable section:

    > **This is a free idea — your pick.** Take any angle from your usual content that honestly connects to the focus area. Need a jumping-off point? Browse the IM8 idea bank here: [IM8 Idea Bank](https://drive.google.com/file/d/12gw4K3x-Zyv6TvgvsBtI7XH_BvQ-BHgn/view)
    >
    > Let us know what you land on before you film so we can make sure it fits into the broader campaign.

    Always include the Idea Bank link inside every free-idea section. Do not invent angle suggestions for free-idea deliverables — the whole point is that the creator chooses.
8. Fill the AMBASSADOR RESEARCH section in Part 1 with the research data above (Profile / Content Style Profile / Verified Credibility Anchors / Reference Video Notes)
9. Three hook options per reel must sound like THIS ambassador, not generic ad copy
10. Every IM8 ingredient claim in the IM8 reveal section must use a clinical dose from the ingredient research above — no invented doses
11. Focus area(s) woven through ALL sections — Reel, Story Sets, Raw Footage, B-roll list
12. Include @im8health in the tagging spec
13. **FORMATTING.** Use proper markdown throughout for Google Docs conversion:
    - Level-1 section titles: \`# HEADING\` (renders as Heading 1 in Google Docs)
    - Section sub-heads: \`## Subheading\`
    - Emphasis on labels and key terms: \`**Bold**\`
    - Every section header, deliverable header, and major label MUST be bold via \`**\` or use a \`#\` / \`##\` heading. Plain text headers render as body text and are hard to scan.

Output the full markdown document. Do NOT wrap in code fences. Begin immediately with the "# ⚠ INTERNAL — DELETE BEFORE SENDING TO AMBASSADOR" heading. Part 1 must end with exactly two consecutive horizontal rules (\`---\\n---\`) on their own lines, then Part 2 begins with the \`# IM8 × <Ambassador Name>\` heading — this is how the pipeline separates internal vs ambassador-facing content.`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runAmbassadorBrief({ rawText, slackChannel, threadTs }) {
  const inputs = parseInputs(rawText);
  log(`Parsed inputs: ${Object.keys(inputs).join(', ')}`);

  // 1. Validate required fields
  const missing = missingFields(inputs);
  if (missing.length > 0) {
    const msg = `:warning: Missing required field(s): *${missing.join(', ')}*. Please reply with each as \`field: value\` and I'll regenerate.`;
    if (slackChannel && threadTs) await sendSlackThread(slackChannel, threadTs, msg);
    return { error: 'missing-fields', missing };
  }

  // 2. Roster lookup
  let roster = loadRoster();
  let rosterEntry = findInRoster(roster, { name: inputs.name, handle: inputs.handle });
  if (rosterEntry) {
    log(`Roster hit: ${rosterEntry.name}`);
  } else {
    log(`Roster miss for handle=${inputs.handle} name=${inputs.name || '(none)'} — auto-discovering`);
    if (slackChannel && threadTs) {
      await sendSlackThread(slackChannel, threadTs, `:bulb: New creator detected (\`${inputs.handle}\`). Researching and adding to the roster + Influencer Tracker now...`);
    }
    rosterEntry = await autoDiscoverAndAdd({ name: inputs.name, handle: inputs.handle, focus: inputs.focus });
    if (!rosterEntry) {
      const msg = `:x: Auto-discovery failed for \`${inputs.handle}\`. Please add manually via \`research-im8-roster.js --add\` and retry.`;
      if (slackChannel && threadTs) await sendSlackThread(slackChannel, threadTs, msg);
      return { error: 'auto-discovery-failed' };
    }
  }

  // 3. Ingredient research
  log(`Researching IM8 ingredients for: ${inputs.focus}`);
  const ingredientResearch = await researchIngredients(inputs.focus);

  // 4. Build prompt + generate
  const skill = loadSkillFiles();
  const prompt = buildPrompt({ inputs, rosterEntry, ingredientResearch, ...skill });
  log(`Calling Claude — prompt size: ${Math.round(prompt.length / 1000)}K chars`);
  const briefDocFull = await callClaude(prompt, { maxTokens: 8000 });
  log(`Generated ${Math.round(briefDocFull.length / 1000)}K chars`);

  // 5. Strip Part 1 (internal section) — the Doc that lands in Drive is the
  //    ambassador-facing version only. The team sends these directly without
  //    having to delete Part 1 manually.
  const briefDoc = stripInternalSection(briefDocFull);
  log(`Stripped internal section: ${Math.round(briefDocFull.length / 1000)}K -> ${Math.round(briefDoc.length / 1000)}K chars`);

  // 6. Upload to Drive
  const dateStr = new Date().toISOString().slice(0, 10);
  const ambassadorName = (rosterEntry.research?.fullName || rosterEntry.name || 'Unknown').replace(/[^a-zA-Z0-9 ]/g, '');
  const docName = `IM8 x ${ambassadorName} - ${dateStr}`;
  log(`Uploading Google Doc: ${docName}`);
  const drive = getDrive();
  const doc = await uploadGoogleDoc(drive, OUTPUT_FOLDER_ID, docName, briefDoc);
  log(`Doc created: ${doc.webViewLink}`);

  // 6. Update existing ambassador row in Influencer Tracker (or append if new).
  //    Update path: column G (focus) + column H (Doc link) + brief status / date.
  //    Append path: fill as many roster fields as possible so the new row is rich.
  let sheetTab = '';
  let sheetMode = '';
  let sheetRowIndex = null;
  try {
    const research = rosterEntry.research || {};
    const isReal = v => v && v !== 'unknown' && v !== 'null';
    const handle = isReal(research.primaryHandle) ? research.primaryHandle : inputs.handle;
    const audienceParts = research.audienceSize
      ? Object.entries(research.audienceSize).filter(([_, v]) => isReal(v)).map(([k, v]) => `${k} ${v}`)
      : [];
    const topicParts = (research.topicMatch || []).filter(isReal);
    const richComments = [
      `Handle: ${handle}`,
      isReal(research.niche) ? `Niche: ${research.niche}` : null,
      audienceParts.length ? `Audience: ${audienceParts.join(', ')}` : null,
      topicParts.length ? `Topics: ${topicParts.join(', ')}` : null,
      `Discount: ${inputs.code} (${inputs.link})`,
      `Tier: ${inputs.tier}`,
      `Auto-added via NoaOS bot ${new Date().toISOString().slice(0, 10)}`,
    ].filter(Boolean).join(' | ');

    const result = await upsertInfluencerBrief({
      creatorName: ambassadorName,
      scriptConceptsLink: doc.webViewLink,
      briefStatus: 'Auto Briefed',
      directionalNotes: inputs.focus,
      comments: richComments,
      currentStatus: 'Briefed',
      // Fields used only on the append-fallback path:
      type: rosterEntry.type || guessType(inputs.handle, ambassadorName),
      conceptsPerMonth: rosterEntry.deliverables || `Tier ${inputs.tier}`,
      editingStyle: research.contentStyle?.formats?.[0] || '',
      creatorNameCode: ambassadorName.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      creatorType: rosterEntry.type === 'Doctors' ? 'DOC' : rosterEntry.type === 'Nutritionist' ? 'NUTR' : rosterEntry.type === 'Biohackers' ? 'BIO' : 'AMB',
    });
    sheetTab = result.tab;
    sheetMode = result.mode;
    sheetRowIndex = result.rowIndex;
    log(`Sheet ${sheetMode} on "${sheetTab}"${sheetRowIndex ? ` row ${sheetRowIndex}` : ''}`);
  } catch (e) {
    log(`Sheet upsert failed: ${e.message}`);
  }

  // 7. Slack reply
  if (slackChannel && threadTs) {
    const sheetLine = !sheetTab
      ? `:warning: sheet update failed (logged to roster only)`
      : sheetMode === 'updated'
        ? `Sheet: *${sheetTab}* row ${sheetRowIndex} updated with Doc link`
        : `Sheet: *${sheetTab}* (new row appended — creator wasn't on the sheet yet)`;
    const fallback = getLastResolveFallback();
    const fallbackLine = fallback
      ? `:rotating_light: *Heads up:* current-month tab \`${fallback.expected}\` doesn't exist yet. Wrote to \`${fallback.used}\` as fallback. Create the new month's tab when ready.`
      : null;
    const msg = [
      `*IM8 ambassador brief ready*`,
      `Ambassador: *${ambassadorName}* (${inputs.handle})`,
      `Focus: *${inputs.focus}* | Tier: *${inputs.tier}*`,
      sheetLine,
      fallbackLine,
      `Doc: ${doc.webViewLink}`,
    ].filter(Boolean).join('\n');
    await sendSlackThread(slackChannel, threadTs, msg);
  }

  return {
    docUrl: doc.webViewLink,
    docName,
    ambassador: ambassadorName,
    sheetTab,
  };
}

// CLI: node im8-ambassador-brief.js "<input text>" [slack-channel] [thread-ts]
// Pass input text as first arg (use --input @file.txt to read from a file for long input).
if (require.main === module) {
  let [textArg, slackChannel, threadTs] = process.argv.slice(2);
  if (!textArg) {
    console.error('Usage: node im8-ambassador-brief.js "<input text>" [slack-channel] [thread-ts]');
    process.exit(1);
  }
  if (textArg.startsWith('@')) {
    textArg = fs.readFileSync(textArg.slice(1), 'utf8');
  }
  runAmbassadorBrief({ rawText: textArg, slackChannel, threadTs })
    .then(r => { console.log('OK:', r); process.exit(0); })
    .catch(async e => {
      console.error('FAIL:', e);
      if (slackChannel && threadTs) {
        try { await sendSlackThread(slackChannel, threadTs, `:x: ambassador brief failed: ${e.message}`); } catch {}
      }
      process.exit(1);
    });
}

module.exports = { runAmbassadorBrief };
