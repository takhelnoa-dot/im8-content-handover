const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/db');
const { enqueue } = require('../lib/queue');

const router = express.Router();

router.get('/api/categories', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.id, c.name, c.description, c.status, c.created_at,
           COALESCE(vc.video_count, 0) AS video_count
    FROM categories c
    LEFT JOIN (SELECT category_id, COUNT(*) AS video_count FROM video_categories GROUP BY category_id) vc ON vc.category_id = c.id
    ORDER BY c.status ASC, c.name ASC
  `).all();
  res.json({ categories: rows });
});

router.post('/api/categories', (req, res) => {
  const { name, description, status = 'official' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  const id = `cat-${uuidv4()}`;
  db.prepare('INSERT INTO categories (id, name, description, status) VALUES (?, ?, ?, ?)').run(id, name, description || null, status);
  res.json({ category: { id, name, status } });
});

router.patch('/api/categories/:id', (req, res) => {
  const db = getDb();
  const { name, description, status } = req.body;
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (typeof name === 'string') db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, c.id);
  if (typeof description === 'string') db.prepare('UPDATE categories SET description = ? WHERE id = ?').run(description, c.id);
  if (typeof status === 'string') db.prepare('UPDATE categories SET status = ? WHERE id = ?').run(status, c.id);
  res.json({ ok: true });
});

router.post('/api/categories/:id/promote', (req, res) => {
  const db = getDb();
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE categories SET status = 'official' WHERE id = ?").run(c.id);
  const vids = db.prepare("SELECT id FROM videos WHERE status = 'ready'").all();
  for (const v of vids) {
    db.prepare("UPDATE videos SET status = 'tagging' WHERE id = ?").run(v.id);
    enqueue(v.id);
  }
  res.json({ ok: true, requeued: vids.length });
});

router.post('/api/categories/:id/reject', (req, res) => {
  const db = getDb();
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare('INSERT OR REPLACE INTO rejected_categories (name, rejected_at) VALUES (?, CURRENT_TIMESTAMP)').run(c.name);
  db.prepare('DELETE FROM video_categories WHERE category_id = ?').run(c.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

router.post('/api/categories/retag-all', (req, res) => {
  const db = getDb();
  const vids = db.prepare("SELECT id FROM videos WHERE status IN ('ready','failed')").all();
  for (const v of vids) {
    db.prepare("UPDATE videos SET status = 'tagging', error_message = NULL WHERE id = ?").run(v.id);
    enqueue(v.id);
  }
  res.json({ ok: true, requeued: vids.length });
});

module.exports = router;
