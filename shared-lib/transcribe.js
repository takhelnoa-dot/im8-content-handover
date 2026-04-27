// Shared transcription utilities used by both watch-and-upload.js and auto-brief.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const OpenAI = require('openai');

const FFMPEG_PATH = 'ffmpeg';

let openaiClient;
function getOpenAI() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set in environment');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildStandardName(folderParts, fileIndex) {
  const sanitized = folderParts.map(p =>
    p.replace(/[#()]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  );
  return `${sanitized.join('_')}_${String(fileIndex).padStart(2, '0')}`;
}

async function transcribeVideo(tempPath, fileId, tempDir) {
  const dir = tempDir || os.tmpdir();
  const audioPath = path.join(dir, `audio_${fileId}.mp3`);
  try {
    execSync(`"${FFMPEG_PATH}" -i "${tempPath}" -vn -acodec libmp3lame -ab 64k -ar 16000 "${audioPath}" -y`, {
      stdio: 'pipe',
      timeout: 180000,
    });
    const result = await getOpenAI().audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    return result;
  } catch (err) {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    throw err;
  }
}

function buildTranscriptionDesc(result, filePath) {
  let desc = `TRANSCRIPTION\nDuration: ${Math.round(result.duration)}s\nLanguage: ${result.language || 'en'}\n`;
  if (filePath) desc += `Path: ${filePath}\n`;
  desc += `Transcribed: ${new Date().toISOString()}\n`;
  desc += `\n---\n\nFULL TEXT:\n${result.text}\n`;
  if (result.segments && result.segments.length > 0) {
    desc += `\n---\n\nTIMESTAMPED SEGMENTS:\n`;
    for (const seg of result.segments) {
      desc += `[${formatTime(seg.start)} - ${formatTime(seg.end)}] ${seg.text.trim()}\n`;
    }
  }
  return desc;
}

module.exports = {
  FFMPEG_PATH,
  formatTime,
  buildStandardName,
  transcribeVideo,
  buildTranscriptionDesc,
};
