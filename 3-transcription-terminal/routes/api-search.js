const express = require('express');
const { search } = require('../lib/search');

const router = express.Router();

router.get('/api/search', async (req, res) => {
  try {
    const query = (req.query.q || '').toString();
    const speakerIds = (req.query.speakers || '').toString().split(',').filter(Boolean);
    const categoryIds = (req.query.categories || '').toString().split(',').filter(Boolean);
    const limit = Math.min(100, parseInt(req.query.limit || '30', 10));
    const offset = parseInt(req.query.offset || '0', 10);
    const debug = req.query.debug === '1';

    const result = await search({ query, speakerIds, categoryIds, limit, offset, debug });
    res.json(result);
  } catch (e) {
    console.error('[api-search]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
