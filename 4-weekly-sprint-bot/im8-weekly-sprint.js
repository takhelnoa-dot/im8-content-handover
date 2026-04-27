// im8-weekly-sprint.js
// IM8 Weekly Creative Sprint Automation
//
// Reads #IM8-Ad-Production-Internal for the weekly CREATIVE SPRINT message,
// parses Focus 1 ICPs and problems, then runs ad-script-brief-pipeline.js
// once per ICP with appropriate keywords.
//
// Scheduled: PM2 cron every Monday 10 AM
//
// Usage:
//   node im8-weekly-sprint.js                        # Full auto: read Slack, run all ICPs
//   node im8-weekly-sprint.js --test                  # Use sample message instead of Slack
//   node im8-weekly-sprint.js --icp "GLP-1"           # Skip Slack, run single ICP
//   node im8-weekly-sprint.js --dry-run               # Pass --dry-run to pipeline (no API calls)
//   node im8-weekly-sprint.js --test --dry-run         # Full test: sample message + no API calls

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { findMessageByText } = require('./lib/slack-read');
const { sendSlackMessage } = require('./lib/slack-notify');
const { log, error } = require('./lib/logger');

// ── Config ──────────────────────────────────────────────────────────────────
const SPRINT_CHANNEL = 'C0AGEM919QV'; // #IM8-Ad-Production-Internal
const SPRINT_SEARCH_TEXT = 'creative sprint';
const LOOKBACK_HOURS = 72; // covers weekend-posted sprints
const PIPELINE_SCRIPT = path.resolve(__dirname, 'ad-script-brief-pipeline.js');
const CONFIG_PATH = path.resolve(__dirname, 'config/im8-icp-mappings.json');
const CLIENTS_DIR = path.resolve(__dirname, '../../output/clients');
const PRODUCT_NAME = 'IM8 Daily Ultimate Essentials';
const DEFAULT_PRODUCT_URL = 'https://im8health.com';
const PIPELINE_TIMEOUT_MS = 45 * 60 * 1000; // 45 min per ICP

const DRY_RUN = process.argv.includes('--dry-run');
const TEST_MODE = process.argv.includes('--test');
const SINGLE_ICP = getArg('--icp');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

// ── Sample sprint message for --test mode ───────────────────────────────────
const SAMPLE_SPRINT_MESSAGE = `🚨CREATIVE SPRINT

Focus 1
Landing Pages
1/ Menopause (https://get.im8health.com/pages/menopause) - same as last sprint!
2/ GLP-1 - same as sprint 1
ICPs: Menopause, GLP-1
Problems: Broad
Who: @Daryl Luke

Focus 2
Landing Pages
1/ Something else
ICPs: General
Problems: Brand
Who: @Someone`;

// ── Load ICP config ─────────────────────────────────────────────────────────
function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function resolveIcpName(config, name) {
  const trimmed = name.trim();
  // Direct match in icps
  if (config.icps[trimmed]) return trimmed;
  // Check aliases (case-insensitive)
  const lower = trimmed.toLowerCase();
  if (config.aliases[lower]) return config.aliases[lower];
  if (config.aliases[trimmed]) return config.aliases[trimmed];
  // Try case-insensitive match against ICP keys
  for (const key of Object.keys(config.icps)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

// ── Parse sprint message ────────────────────────────────────────────────────
function parseSprintMessage(text) {
  // Strip Slack bold/italic markers so *ICPs*: and _description_ don't break regexes
  const cleaned = text.replace(/[*_]/g, '');

  // Take only Focus 1 section (everything before Focus 2)
  const focus2Idx = cleaned.search(/focus\s*2/i);
  const focus1Text = focus2Idx >= 0 ? cleaned.slice(0, focus2Idx) : cleaned;

  // Extract ICPs — handles both formats:
  //   Classic:  ICPs: Menopause, GLP-1
  //   Bullet:   ICPs: (description)\n• Users with PCOS\n• Users with ADHD
  let icps = [];
  const icpMatch = focus1Text.match(/ICPs?:\s*(.+)/i);
  if (icpMatch) {
    const icpMatchIdx = focus1Text.search(/ICPs?:/i);
    const afterIcpLine = focus1Text.slice(icpMatchIdx).split('\n').slice(1);
    const bulletLines = afterIcpLine
      .map(l => l.trim())
      .filter(l => /^[•\-]/.test(l))
      .map(l => l.replace(/^[•\-]\s*/, '').replace(/^Users?\s+with\s+/i, '').trim())
      .filter(Boolean);

    if (bulletLines.length > 0) {
      icps = bulletLines;
    } else {
      icps = icpMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  // Extract Problems
  let problems = [];
  let isBroad = false;
  const probMatch = focus1Text.match(/Problems?:\s*(.+)/i);
  if (probMatch) {
    const probText = probMatch[1].trim();
    if (probText.toLowerCase() === 'broad') {
      isBroad = true;
    } else {
      problems = probText.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  // Extract landing pages (numbered list items with optional URLs)
  const landingPages = {};
  const lpRegex = /\d+\/\s*([^(\n]+?)(?:\s*\(([^)]+)\))?(?:\s*[-–].*)?\s*$/gm;
  let lpMatch;
  while ((lpMatch = lpRegex.exec(focus1Text)) !== null) {
    const name = lpMatch[1].trim();
    const url = lpMatch[2] ? lpMatch[2].trim() : null;
    landingPages[name] = url;
  }

  // Fallback: if no ICPs line found, try to extract from landing page names
  if (icps.length === 0 && Object.keys(landingPages).length > 0) {
    icps = Object.keys(landingPages);
    log('parser', 'No ICPs: line found, falling back to landing page names');
  }

  return { icps, problems, isBroad, landingPages };
}

// ── Build pipeline args for an ICP ──────────────────────────────────────────
function buildPipelineArgs(icpConfig, icpName, problems, isBroad, landingPages, config) {
  // Start with base ICP keywords
  let nicheKeywords = [...icpConfig.nicheKeywords];
  let tiktokKeywords = [...icpConfig.tiktokKeywords];
  let tiktokHashtags = [...icpConfig.tiktokHashtags];

  // If problems are specific (not Broad), add problem-specific keywords
  if (!isBroad && problems.length > 0) {
    for (const prob of problems) {
      const probUpper = prob.toUpperCase();
      if (config.problemKeywords[probUpper]) {
        nicheKeywords.push(...config.problemKeywords[probUpper]);
        tiktokKeywords.push(...config.problemKeywords[probUpper]);
      } else {
        // Unknown problem code -- use it as a raw keyword
        nicheKeywords.push(prob.toLowerCase() + ' supplements');
        tiktokKeywords.push(prob.toLowerCase() + ' supplements');
      }
    }
  }

  // Determine product URL: use landing page from sprint message if available, else ICP config default
  let productUrl = icpConfig.productUrl || DEFAULT_PRODUCT_URL;
  if (landingPages[icpName]) {
    productUrl = landingPages[icpName];
  }

  // Deduplicate keywords
  nicheKeywords = [...new Set(nicheKeywords)];
  tiktokKeywords = [...new Set(tiktokKeywords)];
  tiktokHashtags = [...new Set(tiktokHashtags)];

  const args = [
    PIPELINE_SCRIPT,
    '--client', `IM8 Health ${icpConfig.label}`,
    '--product-name', PRODUCT_NAME,
    '--product-url', productUrl,
    '--niche-keywords', nicheKeywords.join(','),
    '--product-category', 'supplements',
    '--tiktok-keywords', tiktokKeywords.join(','),
    '--tiktok-hashtags', tiktokHashtags.join(','),
    '--slack-channel', SPRINT_CHANNEL,
    '--script-count', '20',
  ];

  if (DRY_RUN) args.push('--dry-run');

  return args;
}

// ── Run pipeline for a single ICP ───────────────────────────────────────────
function runPipeline(args) {
  return new Promise((resolve, reject) => {
    log('pipeline', `Spawning: node ${args.join(' ')}`);
    const child = spawn(process.execPath, args, {
      env: process.env,
      cwd: __dirname,
      stdio: 'inherit',
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Pipeline timed out after ${PIPELINE_TIMEOUT_MS / 1000 / 60} min`));
    }, PIPELINE_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Pipeline exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Check for duplicate run today ───────────────────────────────────────────
function alreadyRanToday(slug) {
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(CLIENTS_DIR, slug);
  if (!fs.existsSync(outputDir)) return false;
  const scriptsFile = path.join(outputDir, `scripts-${today}.txt`);
  return fs.existsSync(scriptsFile);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log('sprint', '=== IM8 Weekly Sprint Automation ===');
  const config = loadConfig();

  // Step 1: Get sprint message
  let sprintText;

  if (SINGLE_ICP) {
    // --icp flag: skip Slack, run single ICP directly
    log('sprint', `Single ICP mode: ${SINGLE_ICP}`);
    const resolvedName = resolveIcpName(config, SINGLE_ICP);
    if (!resolvedName) {
      error('sprint', `Unknown ICP: "${SINGLE_ICP}". Check config/im8-icp-mappings.json`);
      process.exit(1);
    }
    const icpConfig = config.icps[resolvedName];
    const args = buildPipelineArgs(icpConfig, resolvedName, [], true, {}, config);

    log('sprint', `Running pipeline for ${resolvedName}`);
    try {
      await runPipeline(args);
      log('sprint', `Pipeline complete for ${resolvedName}`);
    } catch (err) {
      error('sprint', `Pipeline failed for ${resolvedName}: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (TEST_MODE) {
    log('sprint', 'Using sample sprint message (--test mode)');
    sprintText = SAMPLE_SPRINT_MESSAGE;
  } else {
    log('sprint', `Searching Slack channel ${SPRINT_CHANNEL} for sprint message`);
    const msg = await findMessageByText(SPRINT_CHANNEL, SPRINT_SEARCH_TEXT, LOOKBACK_HOURS);
    if (!msg) {
      const warning = 'No CREATIVE SPRINT message found in the last 72 hours. Skipping this week.';
      log('sprint', warning);
      if (!DRY_RUN) {
        await sendSlackMessage(SPRINT_CHANNEL,
          `*IM8 Sprint Automation:* ${warning}\n\nExpected a message containing "CREATIVE SPRINT" in this channel.`
        );
      }
      process.exit(0);
    }
    sprintText = msg.text;
  }

  // Step 2: Parse sprint message
  const parsed = parseSprintMessage(sprintText);
  log('sprint', `Parsed sprint: ${parsed.icps.length} ICPs [${parsed.icps.join(', ')}], Problems: ${parsed.isBroad ? 'Broad' : parsed.problems.join(', ')}`);

  if (parsed.icps.length === 0) {
    const warning = 'Sprint message found but no ICPs could be extracted. Check the message format.';
    error('sprint', warning);
    if (!DRY_RUN) {
      await sendSlackMessage(SPRINT_CHANNEL, `*IM8 Sprint Automation:* ${warning}`);
    }
    process.exit(1);
  }

  // Step 3: Resolve ICPs and validate
  const icpRuns = [];
  const unknownIcps = [];

  for (const icpName of parsed.icps) {
    const resolvedName = resolveIcpName(config, icpName);
    if (!resolvedName) {
      unknownIcps.push(icpName);
      continue;
    }
    icpRuns.push({ name: resolvedName, config: config.icps[resolvedName], originalName: icpName });
  }

  if (unknownIcps.length > 0) {
    const msg = `Unknown ICPs skipped: ${unknownIcps.join(', ')}. Add them to config/im8-icp-mappings.json`;
    log('sprint', msg);
    if (!DRY_RUN) {
      await sendSlackMessage(SPRINT_CHANNEL, `*IM8 Sprint Automation:* ${msg}`);
    }
  }

  if (icpRuns.length === 0) {
    error('sprint', 'No valid ICPs to process. Exiting.');
    process.exit(1);
  }

  // Step 4: Notify start
  const estMinutes = icpRuns.length * 30;
  if (!DRY_RUN) {
    await sendSlackMessage(SPRINT_CHANNEL,
      `*IM8 Sprint Automation triggered*\n` +
      `Processing ${icpRuns.length} ICP${icpRuns.length > 1 ? 's' : ''}: ${icpRuns.map(r => r.name).join(', ')}\n` +
      `Problems: ${parsed.isBroad ? 'Broad (using defaults)' : parsed.problems.join(', ')}\n` +
      `Estimated time: ~${estMinutes} minutes\n` +
      `Each ICP will get 20 scripts via Foreplay winning ads + TikTok trends.`
    );
  }

  // Step 5: Run pipeline for each ICP sequentially
  const results = [];

  for (const icpRun of icpRuns) {
    const { name, config: icpConfig } = icpRun;

    // Check for duplicate run today
    if (alreadyRanToday(icpConfig.slug)) {
      log('sprint', `Skipping ${name}: already ran today (output exists for ${new Date().toISOString().split('T')[0]})`);
      results.push({ name, status: 'skipped', reason: 'already ran today' });
      continue;
    }

    log('sprint', `--- Starting pipeline for ${name} ---`);
    const args = buildPipelineArgs(icpConfig, icpRun.originalName, parsed.problems, parsed.isBroad, parsed.landingPages, config);

    try {
      await runPipeline(args);
      log('sprint', `Pipeline complete for ${name}`);
      results.push({ name, status: 'success' });
    } catch (err) {
      error('sprint', `Pipeline failed for ${name}: ${err.message}`);
      results.push({ name, status: 'failed', reason: err.message });
    }
  }

  // Step 6: Post summary
  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed');
  const skipped = results.filter(r => r.status === 'skipped');

  let summary = `*IM8 Sprint Automation complete*\n`;
  summary += `${succeeded}/${icpRuns.length} ICPs processed successfully`;
  if (skipped.length > 0) summary += ` (${skipped.length} skipped: already ran today)`;
  summary += '\n';
  if (failed.length > 0) {
    summary += `\nFailed: ${failed.map(f => `${f.name} (${f.reason})`).join(', ')}`;
  }
  summary += '\nScripts are in Google Sheets. Check thread notifications above for details.';

  log('sprint', summary.replace(/\*/g, ''));
  if (!DRY_RUN) {
    await sendSlackMessage(SPRINT_CHANNEL, summary);
  }

  // Exit with error if any failed
  if (failed.length > 0) process.exit(1);
}

main().catch(err => {
  error('sprint', `Fatal error: ${err.message}`);
  process.exit(1);
});
