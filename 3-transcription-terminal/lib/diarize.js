const { AssemblyAI } = require('assemblyai');
const fs = require('fs');
const config = require('./config');

let client;
function getClient() {
  if (!client) {
    if (!config.assemblyaiApiKey) throw new Error('ASSEMBLYAI_API_KEY not set');
    client = new AssemblyAI({ apiKey: config.assemblyaiApiKey });
  }
  return client;
}

async function diarizeAudio(audioPath) {
  const c = getClient();
  const transcript = await c.transcripts.transcribe({
    audio: fs.createReadStream(audioPath),
    speaker_labels: true,
  });
  if (transcript.status === 'error') throw new Error(transcript.error);
  return (transcript.utterances || []).map(u => ({
    speaker_label: u.speaker,
    start_seconds: u.start / 1000,
    end_seconds: u.end / 1000,
    text: u.text,
  }));
}

module.exports = { diarizeAudio };
