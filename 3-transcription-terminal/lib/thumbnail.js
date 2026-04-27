const { execSync } = require('child_process');
const ffprobePath = require('ffprobe-static').path;
const fs = require('fs');
const path = require('path');

function probeDuration(videoPath) {
  const out = execSync(
    `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
    { encoding: 'utf8', timeout: 60000 }
  );
  return parseFloat(out.trim());
}

function hasAudioStream(videoPath) {
  try {
    const out = execSync(
      `"${ffprobePath}" -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function extractThumbnail(videoPath, outPath, atSeconds = 2) {
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execSync(
    `ffmpeg -ss ${atSeconds} -i "${videoPath}" -frames:v 1 -vf "scale=480:-1" "${outPath}" -y`,
    { stdio: 'pipe', timeout: 60000 }
  );
  return outPath;
}

module.exports = { probeDuration, extractThumbnail, hasAudioStream };
