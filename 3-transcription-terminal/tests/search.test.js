const test = require('node:test');
const assert = require('node:assert/strict');
const { blendScores } = require('../lib/search');

test('blendScores normalizes and combines lexical and semantic', () => {
  const input = [
    { segmentId: 1, lexicalRank: 0,  semanticDistance: 0.1 },
    { segmentId: 2, lexicalRank: 2,  semanticDistance: 0.3 },
    { segmentId: 3, lexicalRank: null, semanticDistance: 0.5 },
    { segmentId: 4, lexicalRank: 1,  semanticDistance: null },
  ];
  const result = blendScores(input, { wLex: 0.4, wSem: 0.6 });
  assert.ok(result[0].combined >= result[result.length - 1].combined);
  assert.equal(result.length, 4);
  for (const r of result) assert.equal(typeof r.combined, 'number');
});

test('blendScores handles all-null-lexical (pure semantic) gracefully', () => {
  const input = [
    { segmentId: 1, lexicalRank: null, semanticDistance: 0.1 },
    { segmentId: 2, lexicalRank: null, semanticDistance: 0.5 },
  ];
  const result = blendScores(input, { wLex: 0.4, wSem: 0.6 });
  assert.equal(result[0].segmentId, 1);
});
