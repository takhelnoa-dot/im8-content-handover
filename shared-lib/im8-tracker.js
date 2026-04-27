// Append rows to the IM8 master tracker spreadsheet.
//
// Two write paths:
//   - appendAdCutRow(...)       -> "April Ad Pipeline 2026" (or current month) tab
//   - appendInfluencerRow(...)  -> "April Influencer Tracker 2026" tab
//
// Both use append (not update) so existing rows are never overwritten.
// Tab names follow the "<Month> Ad Pipeline YYYY" / "<Month> Influencer Tracker YYYY"
// pattern. We resolve the current month/year automatically; fall back to the
// nearest existing tab if the current month tab doesn't exist yet.

const { google } = require('googleapis');
const { getAuthClient } = require('../drive-helpers');

const SHEET_ID = '1UoOw8x5QMZwPxldWPTDWGiPzQjGWt7gyf7H93QIKEXQ';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuthClient() });
}

async function listTabs() {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  return meta.data.sheets.map(s => s.properties.title);
}

// Find the CURRENT month's "<Month> <Kind> YYYY" tab. The team creates a
// fresh tab each month (e.g. "April Influencer Tracker 2026" → "May Influencer
// Tracker 2026" on May 1st). We always prefer the tab matching today's
// month+year.
//
// If the current month's tab doesn't exist yet (new month started, team hasn't
// created the tab), we log a LOUD warning and fall back to the most recent
// matching tab. This is safer than failing outright (briefs still go
// somewhere visible) but the warning makes it clear the team needs to make
// the new tab.
// Track whether the last resolveTab call fell back to a stale tab. Callers
// that post Slack replies (pipelines) can surface this to the team so the new
// month's tab gets created promptly.
let lastResolveFellBack = null; // { kind, expected, used } or null

async function resolveTab(kind /* 'Ad Pipeline' | 'Influencer Tracker' */) {
  const tabs = await listTabs();
  const now = new Date();
  const currentMonth = MONTHS[now.getMonth()];
  const currentYear = now.getFullYear();
  const exact = `${currentMonth} ${kind} ${currentYear}`;

  if (tabs.includes(exact)) {
    lastResolveFellBack = null;
    return exact;
  }

  const matching = tabs.filter(t => t.includes(kind));
  if (matching.length === 0) {
    throw new Error(`No tab found matching "${kind}" in IM8 sheet`);
  }
  matching.sort((a, b) => {
    const score = t => {
      const yMatch = t.match(/(\d{4})/);
      const mIdx = MONTHS.findIndex(m => t.startsWith(m));
      return (yMatch ? parseInt(yMatch[1]) * 12 : 0) + (mIdx >= 0 ? mIdx : 0);
    };
    return score(b) - score(a);
  });
  const fallback = matching[0];
  lastResolveFellBack = { kind, expected: exact, used: fallback };
  console.warn(
    `[im8-tracker] WARN: current-month tab "${exact}" not found. ` +
    `Falling back to "${fallback}". Create the new month's tab when ready.`
  );
  return fallback;
}

function getLastResolveFallback() { return lastResolveFellBack; }

async function appendRow(tabName, values) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${tabName}'!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
  return res.data;
}

// Sheets' `append` can land on the wrong row when there are blank-row gaps
// near the top of the table (which the Influencer Tracker has — header bands
// across R1-R4). This helper finds the true last row with a creator name in
// column D and writes a new row directly after it. Returns { rowIndex }.
async function appendInfluencerRowSafe(tabName, rowValues) {
  const sheets = getSheets();
  // Read column D (creator name) — data starts after the header row R5
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${tabName}'!D1:D1000`,
  });
  const rows = res.data.values || [];
  // Header is at R5, real data starts at R6. Find the last row with a real
  // creator name (skip header row itself, URLs, "gary"/sentinel placeholders).
  let lastDataRow = 5; // R5 = header
  for (let i = 5; i < rows.length; i++) {
    const v = (rows[i] && rows[i][0]) ? String(rows[i][0]).trim() : '';
    if (!v) continue;
    if (v.toLowerCase() === 'name') continue;
    if (v.startsWith('http')) continue;
    lastDataRow = i + 1; // 1-based row index
  }
  const targetRow = lastDataRow + 1;
  const lastCol = String.fromCharCode(64 + rowValues.length); // A=65 -> shift
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${tabName}'!A${targetRow}:${lastCol}${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowValues] },
  });
  return { rowIndex: targetRow };
}

// Find the row index (1-based) in the Influencer Tracker tab whose column D
// (creator name) matches the supplied name. Loose matching: case-insensitive,
// whitespace collapsed, and "(parenthetical)" suffixes ignored on both sides.
// Returns null if no match.
async function findInfluencerRowByCreator(tabName, creatorName) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${tabName}'!D1:D1000`,
  });
  const rows = res.data.values || [];
  const norm = s => (s || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const target = norm(creatorName);
  if (!target) return null;
  // Skip header row at R5 ('Name') and any pre-header sentinel rows
  for (let i = 5; i < rows.length; i++) {
    const cell = norm(rows[i] && rows[i][0]);
    if (!cell || cell === 'name') continue;
    if (cell === target) return i + 1;
  }
  // Fuzzy fallback: contains
  for (let i = 5; i < rows.length; i++) {
    const cell = norm(rows[i] && rows[i][0]);
    if (!cell || cell === 'name') continue;
    if (cell.includes(target) || target.includes(cell)) return i + 1;
  }
  return null;
}

// Update specific cells on a known row. cellsByCol is { columnLetter: value }.
async function updateRowCells(tabName, rowIndex, cellsByCol) {
  const sheets = getSheets();
  const data = Object.entries(cellsByCol).map(([col, val]) => ({
    range: `'${tabName}'!${col}${rowIndex}`,
    values: [[val]],
  }));
  if (data.length === 0) return null;
  const res = await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
  return res.data;
}

// Append an ad-cut row to the current month's Ad Pipeline tab.
// Column order matches the tab header (R5):
// (A blank) | Name | Concept Reference | Execution | Script/Concept Link |
// Concept Name / Description | Problem | Persona | Raw Footage Link |
// Comments | Type | Winner Iteration Ref | Editing Style | PIC | Editor |
// DD Draft | DD Final | Current Status | Frame IO Link | # Of Videos |
// Landing Page | Uploaded? | Week Completed | Reported? | Handover Link | YYMMDD
async function appendAdCutRow({
  name,                    // _VID_..._INT_..._* naming
  conceptReference = '',   // URL to source raw footage / Foreplay
  execution = 'Internal Editing Only',
  scriptConceptLink,       // Google Doc URL (the ad cut brief)
  conceptDescription,      // 1-line description of this cut
  problem,                 // ICP problem code, e.g. GUTHEALTH, BRAIN
  persona,                 // ICP persona code, e.g. MENO, PCOS, GLP, ADHD
  rawFootageLink = '',
  comments = '',
  type = '100% Net New',
  winnerIterationRef = '',
  editingStyle = 'TikTok Organic',
  pic = 'Noa',
  editor = '',
  ddDraft = '',
  ddFinal = '',
  currentStatus = 'Ready To Start!',
  frameIoLink = '',
  videoCount = '',
  landingPage = '',
  uploaded = 'FALSE',
  weekCompleted = '',
  reported = '',
  handoverLink = '',
  yymmdd = '',
}) {
  const tab = await resolveTab('Ad Pipeline');
  const row = [
    '',                       // A (blank leading col)
    name,                     // B - Name
    conceptReference,         // C
    execution,                // D
    scriptConceptLink,        // E
    conceptDescription,       // F
    problem,                  // G
    persona,                  // H
    rawFootageLink,           // I
    comments,                 // J
    type,                     // K
    winnerIterationRef,       // L
    editingStyle,             // M
    pic,                      // N
    editor,                   // O
    ddDraft,                  // P
    ddFinal,                  // Q
    currentStatus,            // R
    frameIoLink,              // S
    videoCount,               // T
    landingPage,              // U
    uploaded,                 // V
    weekCompleted,            // W
    reported,                 // X
    handoverLink,             // Y
    yymmdd,                   // Z
  ];
  await appendRow(tab, row);
  return { tab };
}

// Append an ambassador brief row to the current month's Influencer Tracker tab.
// Column order matches the tab header (R4):
// ID | Name | Type | Name | # of Concepts/M | Brief Status |
// Directional Notes [by Noa] | Script/Concepts Link | Submitted Date |
// Raw Footage Link | Comments | Editing Style | PIC | Editor | DD Draft |
// DD Final | Current Status | Frame IO Link | # Of Videos | Landing Page |
// Uploaded? | Format | Creative # | Batchname | Creator Name | Creator Type
//
// Note: column B "Name" is the ad-name, column D "Name" is the creator name.
async function appendInfluencerRow({
  id = '',
  adName = '',                 // Column B - the auto-named ad ID
  type,                        // Doctors / Athletes/Fitness / Nutritionist / Biohackers / Lifestyle
  creatorName,                 // Column D - human name
  conceptsPerMonth = '',       // e.g. "1 reel"
  briefStatus = 'Auto Briefed',
  directionalNotes = '',       // Focus area: PCOS, GLP-1, Perimenopause, etc
  scriptConceptsLink,          // Google Doc URL of the ambassador brief
  submittedDate = new Date().toISOString().slice(0, 10),
  rawFootageLink = '',
  comments = '',
  editingStyle = '',
  pic = 'Noa',
  editor = '',
  ddDraft = '',
  ddFinal = '',
  currentStatus = 'Briefed',
  frameIoLink = '',
  videoCount = '',
  landingPage = '',
  uploaded = 'FALSE',
  format = 'VID',
  creativeNumber = '1',
  batchname = 'INT',
  creatorNameCode = '',        // ASCII code for naming (e.g. MONASHARMA)
  creatorType = '',            // ATH, DOC, KOL, AMB, etc
}) {
  const tab = await resolveTab('Influencer Tracker');
  const row = [
    id,                       // A
    adName,                   // B
    type,                     // C
    creatorName,              // D
    conceptsPerMonth,         // E
    briefStatus,              // F
    directionalNotes,         // G
    scriptConceptsLink,       // H
    submittedDate,            // I
    rawFootageLink,           // J
    comments,                 // K
    editingStyle,             // L
    pic,                      // M
    editor,                   // N
    ddDraft,                  // O
    ddFinal,                  // P
    currentStatus,            // Q
    frameIoLink,              // R
    videoCount,               // S
    landingPage,              // T
    uploaded,                 // U
    format,                   // V
    creativeNumber,           // W
    batchname,                // X
    creatorNameCode,          // Y
    creatorType,              // Z
  ];
  const result = await appendInfluencerRowSafe(tab, row);
  return { tab, rowIndex: result.rowIndex };
}

// Update an existing ambassador row when a brief is generated for someone
// already on the sheet. Returns { tab, rowIndex, mode: 'updated' | 'appended' }.
// If the creator can't be found, falls back to appending a new row.
async function upsertInfluencerBrief({
  creatorName,
  scriptConceptsLink,    // Doc URL — column H
  briefStatus = 'Auto Briefed',
  directionalNotes,      // column G — focus area: Perimenopause / GLP-1 / PCOS / etc
  comments,              // column K
  // Fields used when creator isn't on the sheet yet (auto-discovery append path):
  type,
  conceptsPerMonth,
  rawFootageLink = '',
  editingStyle = '',
  pic = 'Noa',
  currentStatus = 'Briefed',
  format = 'VID',
  creativeNumber = '1',
  batchname = 'INT',
  creatorNameCode,
  creatorType,
}) {
  const tab = await resolveTab('Influencer Tracker');
  const rowIndex = await findInfluencerRowByCreator(tab, creatorName);

  if (rowIndex) {
    const cells = {
      F: briefStatus,                                    // Brief Status
      G: directionalNotes || '',                         // Directional Notes (focus area)
      H: scriptConceptsLink,                             // Script/Concepts Link
      I: new Date().toISOString().slice(0, 10),          // Submitted Date
      Q: currentStatus,                                  // Current Status
    };
    if (comments) cells.K = comments;
    await updateRowCells(tab, rowIndex, cells);
    return { tab, rowIndex, mode: 'updated' };
  }

  // Fallback: creator not on the sheet yet (auto-discovery flow). Append a
  // fully-populated row so future runs can update in place.
  const result = await appendInfluencerRow({
    type,
    creatorName,
    conceptsPerMonth,
    briefStatus,
    directionalNotes,
    scriptConceptsLink,
    rawFootageLink,
    comments,
    editingStyle,
    pic,
    currentStatus,
    uploaded: 'FALSE',
    format,
    creativeNumber,
    batchname,
    creatorNameCode,
    creatorType,
  });
  return { tab, rowIndex: result.rowIndex, mode: 'appended' };
}

module.exports = {
  resolveTab,
  getLastResolveFallback,
  appendAdCutRow,
  appendInfluencerRow,
  findInfluencerRowByCreator,
  updateRowCells,
  upsertInfluencerBrief,
  SHEET_ID,
};
