const OpenAI = require('openai');
const config = require('./config');

let client;
function getClient() {
  if (!client) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY not set');
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

const MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 96;

async function embedTexts(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(t => t || ' ');
    const res = await getClient().embeddings.create({ model: MODEL, input: batch });
    for (const item of res.data) out.push(item.embedding);
  }
  return out;
}

async function embedQuery(text) {
  const [v] = await embedTexts([text]);
  return v;
}

module.exports = { embedTexts, embedQuery, MODEL };
