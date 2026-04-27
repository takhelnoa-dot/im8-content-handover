require('dotenv').config();
const path = require('path');

const DATA_DIR = process.env.TERMINAL_DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  port: parseInt(process.env.PORT || process.env.TERMINAL_PORT || '3006', 10),
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'terminal.db'),
  thumbnailsDir: path.join(DATA_DIR, 'thumbnails'),
  cookieSecret: process.env.TERMINAL_COOKIE_SECRET || require('crypto').randomBytes(32).toString('hex'),
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'change-me',
  openaiApiKey: process.env.OPENAI_API_KEY,
  assemblyaiApiKey: process.env.ASSEMBLYAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  uploadDriveFolderId: process.env.TERMINAL_UPLOAD_DRIVE_FOLDER_ID,
  searchWeightLexical: parseFloat(process.env.SEARCH_WEIGHT_LEXICAL || '0.4'),
  searchWeightSemantic: parseFloat(process.env.SEARCH_WEIGHT_SEMANTIC || '0.6'),
};
