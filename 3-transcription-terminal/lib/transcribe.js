const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const OpenAI = require('openai');
const config = require('./config');

let openaiClient;
function getOpenAI() {
  if (!openaiClient) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY not set');
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

async function transcribeVideo(videoPath, { tempDir = os.tmpdir() } = {}) {
  const audioPath = path.join(tempDir, `audio_${path.basename(videoPath)}.mp3`);
  try {
    execSync(
      `ffmpeg -loglevel error -i "${videoPath}" -vn -acodec libmp3lame -ab 64k -ar 16000 "${audioPath}" -y`,
      { stdio: 'ignore', timeout: 20 * 60 * 1000 }
    );
    const result = await getOpenAI().audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    return result;
  } finally {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}

module.exports = { transcribeVideo };
