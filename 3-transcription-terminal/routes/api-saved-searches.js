const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/db');

const router = express.Router();

router.get('/api/saved-searches', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM saved_searches ORDER BY created_at DESC').all();
  res.json({ saved: rows });
});

router.post('/api/saved-searches', (req, res) => {
  const { name, query, filters } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = `srch-${uuidv4()}`;
  getDb().prepare('INSERT INTO saved_searches (id, username, name, query, filters_json) VALUES (?, ?, ?, ?, ?)').run(
    id, req.user?.user || null, name, query || null, JSON.stringify(filters || {})
  );
  res.json({ saved: { id, name } });
});

router.delete('/api/saved-searches/:id', (req, res) => {
  getDb().prepare('DELETE FROM saved_searches WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
