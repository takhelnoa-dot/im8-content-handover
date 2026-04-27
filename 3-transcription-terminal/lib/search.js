const { getDb } = require('./db');
const { embedQuery } = require('./embed');
const config = require('./config');

function blendScores(rows, { wLex = 0.4, wSem = 0.6 } = {}) {
  const maxLex = Math.max(...rows.map(r => r.lexicalRank ?? -Infinity), 0);
  const maxSem = Math.max(...rows.map(r => r.semanticDistance ?? -Infinity), 0.0001);

  for (const r of rows) {
    const lexScore = r.lexicalRank == null ? 0 : 1 - (r.lexicalRank / (maxLex + 1));
    const semScore = r.semanticDistance == null ? 0 : 1 - (r.semanticDistance / maxSem);
    r.combined = wLex * lexScore + wSem * semScore;
    r.lexScore = lexScore;
    r.semScore = semScore;
  }
  rows.sort((a, b) => b.combined - a.combined);
  return rows;
}

function escapeFtsQuery(q) {
  const tokens = String(q).split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '')}"`);
  return tokens.join(' OR ');
}

async function search({ query, speakerIds = [], categoryIds = [], limit = 30, offset = 0, debug = false }) {
  const db = getDb();

  let lexRows = [];
  let semRows = [];

  if (query && query.trim()) {
    const fts = escapeFtsQuery(query);
    lexRows = db.prepare(`
      SELECT segments.id AS segmentId, segments_fts.rank AS lexicalRank
      FROM segments_fts
      JOIN segments ON segments.id = segments_fts.rowid
      WHERE segments_fts MATCH ?
      ORDER BY segments_fts.rank
      LIMIT 200
    `).all(fts);

    try {
      const qvec = await embedQuery(query);
      const qbuf = Buffer.from(new Float32Array(qvec).buffer);
      semRows = db.prepare(`
        SELECT segment_id AS segmentId, distance AS semanticDistance
        FROM segments_vec
        WHERE embedding MATCH ? AND k = 200
        ORDER BY distance
      `).all(qbuf);
    } catch (e) {
      console.warn('[search] embedding failed, lexical only:', e.message);
    }
  } else {
    lexRows = db.prepare(`
      SELECT id AS segmentId, NULL AS lexicalRank
      FROM segments
      ORDER BY id DESC
      LIMIT 200
    `).all();
  }

  const byId = new Map();
  for (const r of lexRows) byId.set(r.segmentId, { segmentId: r.segmentId, lexicalRank: r.lexicalRank, semanticDistance: null });
  for (const r of semRows) {
    const existing = byId.get(r.segmentId);
    if (existing) existing.semanticDistance = r.semanticDistance;
    else byId.set(r.segmentId, { segmentId: r.segmentId, lexicalRank: null, semanticDistance: r.semanticDistance });
  }

  const blended = blendScores(
    Array.from(byId.values()),
    { wLex: config.searchWeightLexical, wSem: config.searchWeightSemantic }
  );

  const segmentIds = blended.map(b => b.segmentId);
  if (segmentIds.length === 0) return { results: [], debug: debug ? { lexCount: 0, semCount: 0 } : undefined };

  const placeholders = segmentIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT s.id AS segment_id, s.video_id, s.start_seconds, s.end_seconds, s.text, s.speaker_id,
           v.title AS video_title, v.drive_file_id, v.drive_url, v.thumbnail_path,
           sp.name AS speaker_name
    FROM segments s
    JOIN videos v ON v.id = s.video_id
    LEFT JOIN speakers sp ON sp.id = s.speaker_id
    WHERE s.id IN (${placeholders}) AND v.status = 'ready'
  `).all(...segmentIds);

  const byRow = new Map(rows.map(r => [r.segment_id, r]));
  const ordered = blended.map(b => ({ blend: b, row: byRow.get(b.segmentId) })).filter(x => x.row);

  let filtered = ordered;
  if (speakerIds.length) {
    const set = new Set(speakerIds);
    filtered = filtered.filter(x => set.has(x.row.speaker_id));
  }
  if (categoryIds.length) {
    const set = new Set(categoryIds);
    const vidCatRows = db.prepare(`SELECT video_id, category_id FROM video_categories`).all();
    const vidToCats = new Map();
    for (const r of vidCatRows) {
      if (!vidToCats.has(r.video_id)) vidToCats.set(r.video_id, new Set());
      vidToCats.get(r.video_id).add(r.category_id);
    }
    filtered = filtered.filter(x => {
      const cats = vidToCats.get(x.row.video_id);
      if (!cats) return false;
      for (const c of set) if (cats.has(c)) return true;
      return false;
    });
  }

  const paginated = filtered.slice(offset, offset + limit);
  const catsByVid = db.prepare(`
    SELECT vc.video_id, c.id, c.name
    FROM video_categories vc
    JOIN categories c ON c.id = vc.category_id
  `).all();
  const videoCats = new Map();
  for (const r of catsByVid) {
    if (!videoCats.has(r.video_id)) videoCats.set(r.video_id, []);
    videoCats.get(r.video_id).push({ id: r.id, name: r.name });
  }

  return {
    results: paginated.map(x => ({
      segmentId: x.row.segment_id,
      videoId: x.row.video_id,
      videoTitle: x.row.video_title,
      driveFileId: x.row.drive_file_id,
      driveUrl: x.row.drive_url,
      thumbnailPath: x.row.thumbnail_path,
      speakerId: x.row.speaker_id,
      speakerName: x.row.speaker_name,
      startSeconds: x.row.start_seconds,
      endSeconds: x.row.end_seconds,
      text: x.row.text,
      categories: videoCats.get(x.row.video_id) || [],
      score: x.blend.combined,
      lexScore: debug ? x.blend.lexScore : undefined,
      semScore: debug ? x.blend.semScore : undefined,
    })),
    total: filtered.length,
    debug: debug ? { lexCount: lexRows.length, semCount: semRows.length } : undefined,
  };
}

module.exports = { search, blendScores };
