function midpoint(s) {
  return (s.start + s.end) / 2;
}

function assignSpeakersToSegments(whisperSegments, diarUtterances) {
  if (!diarUtterances || diarUtterances.length === 0) {
    return whisperSegments.map(s => ({ ...s, speaker_label: null }));
  }
  return whisperSegments.map(seg => {
    const mid = midpoint(seg);
    let covering = diarUtterances.find(u => mid >= u.start_seconds && mid <= u.end_seconds);
    if (!covering) {
      covering = diarUtterances.slice().sort((a, b) => {
        const da = Math.min(Math.abs(a.start_seconds - mid), Math.abs(a.end_seconds - mid));
        const db = Math.min(Math.abs(b.start_seconds - mid), Math.abs(b.end_seconds - mid));
        return da - db;
      })[0];
    }
    return { ...seg, speaker_label: covering ? covering.speaker_label : null };
  });
}

function dominantLabel(segments) {
  const totals = {};
  for (const s of segments) {
    if (!s.speaker_label) continue;
    totals[s.speaker_label] = (totals[s.speaker_label] || 0) + (s.end - s.start);
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : null;
}

function mergeSegments({ segments, hintedSpeakers = [] }) {
  const labels = [...new Set(segments.map(s => s.speaker_label).filter(Boolean))];
  const speakerMap = {};

  const dominant = dominantLabel(segments);
  if (dominant && hintedSpeakers.length === 1) {
    speakerMap[dominant] = hintedSpeakers[0];
  } else if (hintedSpeakers.length > 1) {
    const sortedLabels = labels.slice().sort((a, b) => {
      const at = segments.filter(s => s.speaker_label === a).reduce((sum, s) => sum + (s.end - s.start), 0);
      const bt = segments.filter(s => s.speaker_label === b).reduce((sum, s) => sum + (s.end - s.start), 0);
      return bt - at;
    });
    for (let i = 0; i < Math.min(sortedLabels.length, hintedSpeakers.length); i++) {
      speakerMap[sortedLabels[i]] = hintedSpeakers[i];
    }
  }

  let unknownCounter = 1;
  for (const label of labels) {
    if (!speakerMap[label]) {
      speakerMap[label] = `Unknown Speaker #${unknownCounter++}`;
    }
  }

  return { speakerMap, segments };
}

module.exports = { assignSpeakersToSegments, mergeSegments };
