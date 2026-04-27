require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./lib/config');
const { getDb } = require('./lib/db');
const { parseCookies, requireAuth, mountAuthRoutes } = require('./lib/auth');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(parseCookies);

if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
if (!fs.existsSync(config.thumbnailsDir)) fs.mkdirSync(config.thumbnailsDir, { recursive: true });

getDb();

app.get('/healthz', (req, res) => res.json({ ok: true, service: 'transcription-terminal' }));

mountAuthRoutes(app);

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));

app.use(requireAuth);

app.use(require('./routes/api-upload'));
app.use(require('./routes/api-search'));
app.use(require('./routes/api-videos'));
app.use(require('./routes/api-speakers'));
app.use(require('./routes/api-categories'));
app.use(require('./routes/api-saved-searches'));
app.use(require('./routes/api-settings'));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(config.port, () => {
  console.log(`[transcription-terminal] running on http://localhost:${config.port}`);
  // Resume any work that was interrupted by the previous process exit.
  try {
    require('./lib/queue').resumeInterrupted();
  } catch (e) {
    console.error('[transcription-terminal] resumeInterrupted failed:', e.message);
  }
});
