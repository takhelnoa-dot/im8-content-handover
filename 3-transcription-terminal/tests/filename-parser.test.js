const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSpeakersFromFilename } = require('../lib/filename-parser');

const rosterStub = [
  { name: 'Alex Reed', aliases: ['alexreed', 'alex-reed'] },
  { name: 'Maya Park', aliases: ['mayapark'] },
];

test('matches a principal by alias', () => {
  const r = parseSpeakersFromFilename('2026-04-06_IM8_Aryna_Reel4.mp4', rosterStub);
  assert.deepEqual(r.speakers, ['Aryna Sabalenka']);
  assert.equal(r.unknown, false);
});

test('matches David Beckham', () => {
  const r = parseSpeakersFromFilename('IM8_DavidBeckham_Training_02.mp4', rosterStub);
  assert.deepEqual(r.speakers, ['David Beckham']);
});

test('matches roster member', () => {
  const r = parseSpeakersFromFilename('IM8_MayaPark_Reel01.mov', rosterStub);
  assert.deepEqual(r.speakers, ['Maya Park']);
});

test('returns unknown=true when no match', () => {
  const r = parseSpeakersFromFilename('random_clip_0023.mp4', rosterStub);
  assert.equal(r.unknown, true);
  assert.deepEqual(r.speakers, []);
});

test('matches multiple speakers if both appear', () => {
  const r = parseSpeakersFromFilename('Aryna_and_Beckham_interview.mp4', rosterStub);
  assert.ok(r.speakers.includes('Aryna Sabalenka'));
  assert.ok(r.speakers.includes('David Beckham'));
});

test('is case-insensitive and tolerates separators', () => {
  const r = parseSpeakersFromFilename('im8--ARYNA_SABALENKA--morning.MP4', rosterStub);
  assert.deepEqual(r.speakers, ['Aryna Sabalenka']);
});
