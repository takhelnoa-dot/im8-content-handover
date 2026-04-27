const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../lib/db');
const { enqueue } = require('../lib/queue');
const config = require('../lib/config');
const drive = require('../lib/drive');

const router = express.Router();

router.get('/api/videos', (req, res) => {
  const db = getDb();
  const status = req.query.status;
  const sort = req.query.sort || 'newest';
  const sortSQL = {
    newest: 'v.added_at DESC',
    oldest: 'v.added_at ASC',
    longest: 'v.duration_seconds DESC',
  }[sort] || 'v.added_at DESC';

  const whereSQL = status ? 'WHERE v.status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`
    SELECT v.id, v.title, v.drive_file_id, v.drive_url, v.duration_seconds, v.thumbnail_path, v.status, v.added_at, v.error_message
    FROM videos v
    ${whereSQL}
    ORDER BY ${sortSQL}
    LIMIT 500
  `).all(...params);

  const ids = rows.map(r => r.id);
  if (!ids.length) return res.json({ videos: [] });
  const placeholders = ids.map(() => '?').join(',');

  const speakers = db.prepare(`
    SELECT vs.video_id, sp.id, sp.name FROM video_speakers vs
    JOIN speakers sp ON sp.id = vs.speaker_id
    WHERE vs.video_id IN (${placeholders})
  `).all(...ids);
  const spByVid = new Map();
  for (const s of speakers) {
    if (!spByVid.has(s.video_id)) spByVid.set(s.video_id, []);
    spByVid.get(s.video_id).push({ id: s.id, name: s.name });
  }
  const cats = db.prepare(`
    SELECT vc.video_id, c.id, c.name FROM video_categories vc
    JOIN categories c ON c.id = vc.category_id
    WHERE vc.video_id IN (${placeholders})
  `).all(...ids);
  const cByVid = new Map();
  for (const c of cats) {
    if (!cByVid.has(c.video_id)) cByVid.set(c.video_id, []);
    cByVid.get(c.video_id).push({ id: c.id, name: c.name });
  }

  res.json({
    videos: rows.map(r => ({
      ...r,
      speakers: spByVid.get(r.id) || [],
      categories: cByVid.get(r.id) || [],
    })),
  });
});

router.get('/api/videos/:id', (req, res) => {
  const db = getDb();
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });
  const segments = db.prepare(`
    SELECT s.id, s.start_seconds, s.end_seconds, s.text, s.speaker_id, sp.name AS speaker_name
    FROM segments s LEFT JOIN speakers sp ON sp.id = s.speaker_id
    WHERE s.video_id = ? ORDER BY s.start_seconds
  `).all(video.id);
  const speakers = db.prepare(`
    SELECT sp.id, sp.name, vs.segment_count FROM video_speakers vs
    JOIN speakers sp ON sp.id = vs.speaker_id
    WHERE vs.video_id = ?
  `).all(video.id);
  const categories = db.prepare(`
    SELECT c.id, c.name, vc.confidence FROM video_categories vc
    JOIN categories c ON c.id = vc.category_id
    WHERE vc.video_id = ?
  `).all(video.id);
  res.json({
    video: {
      ...video,
      preview_url: drive.buildPreviewUrl(video.drive_file_id),
    },
    segments,
    speakers,
    categories,
  });
});

router.patch('/api/videos/:id', (req, res) => {
  const db = getDb();
  const { title } = req.body;
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });
  if (typeof title === 'string') db.prepare('UPDATE videos SET title = ? WHERE id = ?').run(title, video.id);
  res.json({ ok: true });
});

router.patch('/api/videos/:videoId/segments/:segmentId', (req, res) => {
  const db = getDb();
  const { speakerId } = req.body;
  if (speakerId) {
    db.prepare('UPDATE segments SET speaker_id = ? WHERE id = ? AND video_id = ?')
      .run(speakerId, req.params.segmentId, req.params.videoId);
    // Rebuild the per-video speaker aggregates so the right-side panel stays
    // accurate after segment-level reassignment.
    db.prepare('DELETE FROM video_speakers WHERE video_id = ?').run(req.params.videoId);
    db.prepare(`
      INSERT INTO video_speakers (video_id, speaker_id, segment_count)
      SELECT video_id, speaker_id, COUNT(*)
        FROM segments
       WHERE video_id = ? AND speaker_id IS NOT NULL
       GROUP BY speaker_id
    `).run(req.params.videoId);
  }
  res.json({ ok: true });
});

// Add a speaker to a video (creates a video_speakers row with 0 segment count
// so it shows up in the panel). Useful for tagging a panelist who only appears
// in a couple of segments you'd rather leave attributed to someone else.
router.post('/api/videos/:videoId/speakers', (req, res) => {
  const { speakerId } = req.body;
  if (!speakerId) return res.status(400).json({ error: 'speakerId required' });
  getDb().prepare(`
    INSERT INTO video_speakers (video_id, speaker_id, segment_count) VALUES (?, ?, 0)
    ON CONFLICT(video_id, speaker_id) DO NOTHING
  `).run(req.params.videoId, speakerId);
  res.json({ ok: true });
});

// Remove a speaker association from a video. Doesn't delete segments; just
// hides the speaker from this video's summary panel.
router.delete('/api/videos/:videoId/speakers/:speakerId', (req, res) => {
  getDb().prepare('DELETE FROM video_speakers WHERE video_id = ? AND speaker_id = ?')
    .run(req.params.videoId, req.params.speakerId);
  res.json({ ok: true });
});

router.post('/api/videos/:id/retag', async (req, res) => {
  const db = getDb();
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM video_categories WHERE video_id = ?').run(video.id);
  db.prepare("UPDATE videos SET status = 'tagging', error_message = NULL WHERE id = ?").run(video.id);
  enqueue(video.id);
  res.json({ ok: true });
});

router.delete('/api/videos/:id', (req, res) => {
  const db = getDb();
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });
  if (video.thumbnail_path) {
    const abs = path.join(config.dataDir, video.thumbnail_path);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
  db.prepare('DELETE FROM segments_vec WHERE segment_id IN (SELECT id FROM segments WHERE video_id = ?)').run(video.id);
  db.prepare('DELETE FROM videos WHERE id = ?').run(video.id);
  res.json({ ok: true });
});

router.get('/thumbnails/:file', (req, res) => {
  const safe = path.basename(req.params.file);
  const abs = path.join(config.thumbnailsDir, safe);
  if (!fs.existsSync(abs)) return res.status(404).end();
  res.sendFile(abs);
});

module.exports = router;
