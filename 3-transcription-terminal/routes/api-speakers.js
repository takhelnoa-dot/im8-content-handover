const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/db');

const router = express.Router();

router.get('/api/speakers', (req, res) => {
  const db = getDb();
  const hideEmpty = req.query.hideEmpty === '1';
  const where = hideEmpty ? 'WHERE COALESCE(sc.segment_count, 0) > 0' : '';
  const rows = db.prepare(`
    SELECT sp.id, sp.name, sp.notes, sp.is_unknown, sp.is_starred, sp.image_url,
           COALESCE(vs.video_count, 0) AS video_count,
           COALESCE(sc.segment_count, 0) AS segment_count
    FROM speakers sp
    LEFT JOIN (SELECT speaker_id, COUNT(DISTINCT video_id) AS video_count FROM video_speakers GROUP BY speaker_id) vs ON vs.speaker_id = sp.id
    LEFT JOIN (SELECT speaker_id, COUNT(*) AS segment_count FROM segments GROUP BY speaker_id) sc ON sc.speaker_id = sp.id
    ${where}
    ORDER BY sp.is_starred DESC, sp.is_unknown ASC, sp.name ASC
  `).all();
  res.json({ speakers: rows });
});

router.post('/api/speakers/cleanup-orphans', (req, res) => {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM speakers
    WHERE is_unknown = 1
      AND id NOT IN (SELECT DISTINCT speaker_id FROM segments WHERE speaker_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT speaker_id FROM video_speakers)
  `).run();
  res.json({ deleted: result.changes });
});

router.post('/api/speakers', (req, res) => {
  const { name, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const existing = db.prepare('SELECT id FROM speakers WHERE normalized_name = ?').get(normalized);
  if (existing) return res.json({ speaker: { id: existing.id, name } });
  const id = `spk-${uuidv4()}`;
  db.prepare('INSERT INTO speakers (id, name, normalized_name, notes, is_unknown) VALUES (?, ?, ?, ?, 0)').run(id, name, normalized, notes || null);
  res.json({ speaker: { id, name } });
});

router.patch('/api/speakers/:id', (req, res) => {
  const db = getDb();
  const { name, notes, is_starred, image_url } = req.body;
  const sp = db.prepare('SELECT * FROM speakers WHERE id = ?').get(req.params.id);
  if (!sp) return res.status(404).json({ error: 'Not found' });
  if (typeof name === 'string') {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    db.prepare('UPDATE speakers SET name = ?, normalized_name = ?, is_unknown = 0 WHERE id = ?').run(name, normalized, sp.id);
  }
  if (typeof notes === 'string') db.prepare('UPDATE speakers SET notes = ? WHERE id = ?').run(notes, sp.id);
  if (typeof is_starred === 'boolean') db.prepare('UPDATE speakers SET is_starred = ? WHERE id = ?').run(is_starred ? 1 : 0, sp.id);
  if (typeof image_url === 'string') db.prepare('UPDATE speakers SET image_url = ? WHERE id = ?').run(image_url, sp.id);
  res.json({ ok: true });
});

router.post('/api/speakers/merge', (req, res) => {
  const { sourceIds, targetId } = req.body;
  if (!Array.isArray(sourceIds) || !targetId) return res.status(400).json({ error: 'sourceIds + targetId required' });
  const db = getDb();
  const target = db.prepare('SELECT id FROM speakers WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'target not found' });

  const tx = db.transaction(() => {
    for (const src of sourceIds) {
      if (src === targetId) continue;
      db.prepare('UPDATE segments SET speaker_id = ? WHERE speaker_id = ?').run(targetId, src);
      db.prepare(`
        INSERT INTO video_speakers (video_id, speaker_id, segment_count)
        SELECT video_id, ?, segment_count FROM video_speakers WHERE speaker_id = ?
        ON CONFLICT(video_id, speaker_id) DO UPDATE SET segment_count = segment_count + excluded.segment_count
      `).run(targetId, src);
      db.prepare('DELETE FROM video_speakers WHERE speaker_id = ?').run(src);
      db.prepare('DELETE FROM speakers WHERE id = ?').run(src);
    }
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
