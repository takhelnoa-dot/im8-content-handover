const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSegments, assignSpeakersToSegments } = require('../lib/merge-segments');

test('assigns the diarization speaker whose window covers the midpoint of each Whisper segment', () => {
  const whisper = [
    { start: 0,  end: 5,  text: 'hello world' },
    { start: 5,  end: 10, text: 'second line' },
    { start: 10, end: 15, text: 'third line' },
  ];
  const diar = [
    { speaker_label: 'A', start_seconds: 0,  end_seconds: 8 },
    { speaker_label: 'B', start_seconds: 8,  end_seconds: 15 },
  ];
  const result = assignSpeakersToSegments(whisper, diar);
  assert.deepEqual(result.map(r => r.speaker_label), ['A', 'A', 'B']);
});

test('falls back to closest speaker window when no window covers the midpoint', () => {
  const whisper = [{ start: 0, end: 3, text: 'x' }];
  const diar = [
    { speaker_label: 'A', start_seconds: 4, end_seconds: 9 },
    { speaker_label: 'B', start_seconds: 10, end_seconds: 15 },
  ];
  const result = assignSpeakersToSegments(whisper, diar);
  assert.equal(result[0].speaker_label, 'A');
});

test('returns null speaker_label when diarization is empty', () => {
  const whisper = [{ start: 0, end: 3, text: 'x' }];
  const result = assignSpeakersToSegments(whisper, []);
  assert.equal(result[0].speaker_label, null);
});

test('mergeSegments maps dominant diarization label to hinted speaker name', () => {
  const segments = [
    { start: 0, end: 5,  text: 'a', speaker_label: 'A' },
    { start: 5, end: 10, text: 'b', speaker_label: 'A' },
    { start: 10, end: 12, text: 'c', speaker_label: 'B' },
  ];
  const result = mergeSegments({
    segments,
    hintedSpeakers: ['Dr. James DiNicolantonio'],
  });
  assert.equal(result.speakerMap.A, 'Dr. James DiNicolantonio');
  assert.ok(/^Unknown Speaker/.test(result.speakerMap.B));
});

test('mergeSegments with no hints returns Unknown Speaker names for all labels', () => {
  const segments = [
    { start: 0, end: 5, text: 'a', speaker_label: 'A' },
    { start: 5, end: 10, text: 'b', speaker_label: 'B' },
  ];
  const result = mergeSegments({ segments, hintedSpeakers: [] });
  assert.ok(/^Unknown Speaker/.test(result.speakerMap.A));
  assert.ok(/^Unknown Speaker/.test(result.speakerMap.B));
  assert.notEqual(result.speakerMap.A, result.speakerMap.B);
});
