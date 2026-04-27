const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
const config = require('./config');

let client;
function getClient() {
  if (!client) {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not set');
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

const MODEL = 'claude-sonnet-4-6';

function buildPrompt({ transcript, officialCategories, proposedCategories }) {
  const officialBlock = officialCategories.map(c => `- ${c.name}: ${c.description || '(no description)'}`).join('\n');
  const proposedBlock = proposedCategories.length
    ? proposedCategories.map(c => `- ${c.name}: ${c.description || '(no description)'}`).join('\n')
    : '(none yet)';

  return `You are tagging IM8 raw footage transcripts with categories for ad production.

OFFICIAL CATEGORIES (always prefer these when content fits):
${officialBlock}

PROPOSED CATEGORIES (previously suggested, not yet promoted):
${proposedBlock}

TRANSCRIPT:
"""
${transcript}
"""

Return a JSON object with this exact shape:
{
  "matched": [
    { "name": "<existing category name>", "confidence": <0.0-1.0> }
  ],
  "proposed": [
    { "name": "<short new category name>", "description": "<one sentence>", "confidence": <0.0-1.0> }
  ]
}

Rules:
- "matched" contains 3-6 items from OFFICIAL or PROPOSED, sorted by confidence descending.
- Only include "proposed" if a clear theme is not covered by any existing category. Cap proposed at 2.
- Use Title Case for new category names. Keep names under 25 characters.
- Confidence is how strongly the transcript supports that category.
- Do NOT propose generic catch-all categories like "Unrelated Content", "Other", "Off Topic", "B-Roll", "Misc", "General". If no IM8-relevant theme fits, return an empty "matched" array and no proposed categories — leaving the video uncategorized is fine.
- IM8 is the brand name. Treat "IMA" or "I am eight" in the transcript as "IM8" (Whisper transcription artifact).
- Return ONLY the JSON, no prose.`;
}

async function categorizeTranscript({ transcript, officialCategories, proposedCategories }) {
  const prompt = buildPrompt({ transcript, officialCategories, proposedCategories });
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content[0].text.trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  const json = text.slice(jsonStart, jsonEnd + 1);
  return JSON.parse(json);
}

module.exports = { categorizeTranscript };
