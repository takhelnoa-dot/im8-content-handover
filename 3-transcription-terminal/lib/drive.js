const { google } = require('googleapis');
const fs = require('fs');
const config = require('./config');

let driveClient;

function getDrive() {
  if (driveClient) return driveClient;
  if (!config.googleServiceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  }
  const decoded = Buffer.from(config.googleServiceAccountJson, 'base64').toString('utf8');
  const credentials = JSON.parse(decoded);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

function extractFileId(url) {
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  return null;
}

function extractFolderId(url) {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function getFileMetadata(fileId) {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, webViewLink, parents',
    supportsAllDrives: true,
  });
  return res.data;
}

const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function listVideoFilesInFolder(folderId, { maxDepth = 6, maxFiles = 500 } = {}) {
  const drive = getDrive();
  const out = [];
  const seen = new Set();
  async function walk(id, depth, pathPrefix) {
    if (depth > maxDepth || out.length >= maxFiles || seen.has(id)) return;
    seen.add(id);
    let pageToken;
    do {
      const res = await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink)',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files || []) {
        if (out.length >= maxFiles) break;
        if (f.mimeType === FOLDER_MIME) {
          await walk(f.id, depth + 1, `${pathPrefix}${f.name}/`);
        } else if (VIDEO_MIMES.includes(f.mimeType)) {
          out.push({ ...f, path: `${pathPrefix}${f.name}` });
        }
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken && out.length < maxFiles);
  }
  await walk(folderId, 0, '');
  return out;
}

async function downloadFile(fileId, destPath) {
  const drive = getDrive();
  const dest = fs.createWriteStream(destPath);
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    res.data
      .on('error', reject)
      .pipe(dest)
      .on('finish', resolve)
      .on('error', reject);
  });
  return destPath;
}

async function uploadFile(localPath, name, folderId) {
  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: { name, parents: folderId ? [folderId] : undefined },
    media: { body: fs.createReadStream(localPath) },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return res.data;
}

function buildViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function buildPreviewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

module.exports = {
  getDrive,
  extractFileId,
  extractFolderId,
  getFileMetadata,
  listVideoFilesInFolder,
  downloadFile,
  uploadFile,
  buildViewUrl,
  buildPreviewUrl,
};
