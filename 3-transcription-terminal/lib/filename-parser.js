const principals = require('./principals');

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseSpeakersFromFilename(filename, rosterExtra = []) {
  const normalized = normalize(filename);
  const allEntries = [...principals, ...(rosterExtra || [])];
  const matched = new Set();

  for (const entry of allEntries) {
    for (const alias of entry.aliases || []) {
      if (normalized.includes(normalize(alias))) {
        matched.add(entry.name);
        break;
      }
    }
  }

  const speakers = Array.from(matched);
  return { speakers, unknown: speakers.length === 0 };
}

module.exports = { parseSpeakersFromFilename };
