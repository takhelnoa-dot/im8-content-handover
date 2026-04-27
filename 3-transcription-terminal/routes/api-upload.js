const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/db');
const drive = require('../lib/drive');
const config = require('../lib/config');
const { enqueue, getQueueSnapshot } = require('../lib/queue');

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

router.post('/api/upload/inspect', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const folderId = drive.extractFolderId(url);
  if (folderId) {
    try {
      const files = await drive.listVideoFilesInFolder(folderId);
      return res.json({ type: 'folder', folderId, files });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const fileId = drive.extractFileId(url);
  if (!fileId) return res.status(400).json({ error: 'Not a recognized Drive URL' });
  try {
    const meta = await drive.getFileMetadata(fileId);
    return res.json({ type: 'file', file: meta });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/api/upload/ingest', async (req, res) => {
  const { fileIds, speakerHint } = req.body;
  if (!Array.isArray(fileIds) || fileIds.length === 0) return res.status(400).json({ error: 'fileIds required' });

  const db = getDb();
  const results = [];
  for (const fileId of fileIds) {
    const existing = db.prepare('SELECT id FROM videos WHERE drive_file_id = ?').get(fileId);
    if (existing) {
      results.push({ fileId, videoId: existing.id, status: 'already_exists' });
      continue;
    }
    let meta;
    try {
      meta = await drive.getFileMetadata(fileId);
    } catch (e) {
      results.push({ fileId, error: e.message });
      continue;
    }
    const videoId = `vid-${uuidv4()}`;
    db.prepare(`
      INSERT INTO videos (id, drive_file_id, drive_url, title, added_by, status, speaker_hint)
      VALUES (?, ?, ?, ?, ?, 'queued', ?)
    `).run(videoId, fileId, drive.buildViewUrl(fileId), meta.name, req.user?.user || 'unknown', speakerHint || null);
    enqueue(videoId);
    results.push({ fileId, videoId, status: 'queued' });
  }
  res.json({ results });
});

router.post('/api/upload/file', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!config.uploadDriveFolderId) return res.status(500).json({ error: 'TERMINAL_UPLOAD_DRIVE_FOLDER_ID not configured' });

  try {
    const uploaded = await drive.uploadFile(req.file.path, req.file.originalname, config.uploadDriveFolderId);
    fs.unlinkSync(req.file.path);

    const db = getDb();
    const videoId = `vid-${uuidv4()}`;
    db.prepare(`
      INSERT INTO videos (id, drive_file_id, drive_url, title, added_by, status)
      VALUES (?, ?, ?, ?, ?, 'queued')
    `).run(videoId, uploaded.id, drive.buildViewUrl(uploaded.id), uploaded.name, req.user?.user || 'unknown');
    enqueue(videoId);
    res.json({ videoId, driveFileId: uploaded.id });
  } catch (e) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/upload/queue', (req, res) => {
  res.json({ queue: getQueueSnapshot() });
});

router.post('/api/upload/retry/:videoId', async (req, res) => {
  const v = getDb().prepare("SELECT id FROM videos WHERE id = ? AND status = 'failed'").get(req.params.videoId);
  if (!v) return res.status(404).json({ error: 'Failed video not found' });
  getDb().prepare("UPDATE videos SET status='queued', error_message=NULL WHERE id = ?").run(v.id);
  enqueue(v.id);
  res.json({ ok: true });
});

module.exports = router;
