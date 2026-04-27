// drive-helpers.js
// Shared Google Drive auth and helper functions

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = process.env.GOOGLE_OAUTH_CREDENTIALS_PATH || path.join(__dirname, '../../secrets/client_secret_krave.json');
const TOKEN_PATH = process.env.GOOGLE_OAUTH_TOKEN_PATH || path.join(__dirname, '../../secrets/token_krave_drive.json');
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

function getAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost');
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(tokens);

  // Auto-refresh token and save
  oAuth2Client.on('tokens', (newTokens) => {
    const saved = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    Object.assign(saved, newTokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(saved, null, 2));
  });

  return oAuth2Client;
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuthClient() });
}

async function findFolder(drive, name, parentId) {
  const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({ q: query, fields: 'files(id, name)', spaces: 'drive' });
  return res.data.files.length > 0 ? res.data.files[0] : null;
}

async function createFolder(drive, name, parentId) {
  const existing = await findFolder(drive, name, parentId);
  if (existing) return existing;

  const res = await drive.files.create({
    requestBody: {
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, name',
  });
  return res.data;
}

async function ensureFolderPath(drive, pathParts, rootId) {
  let currentId = rootId || ROOT_FOLDER_ID;
  for (const part of pathParts) {
    const folder = await createFolder(drive, part, currentId);
    currentId = folder.id;
  }
  return currentId;
}

async function listFiles(drive, folderId, mimeTypes) {
  const allFiles = [];
  let pageToken = null;

  do {
    const query = `'${folderId}' in parents and trashed=false`;
    const res = await drive.files.list({
      q: query,
      fields: 'nextPageToken, files(id, name, mimeType, createdTime, size)',
      spaces: 'drive',
      pageToken: pageToken,
    });

    for (const file of res.data.files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        // Recurse into subfolders
        const subFiles = await listFiles(drive, file.id, mimeTypes);
        allFiles.push(...subFiles.map((f) => ({ ...f, folder: file.name, folderId: file.id })));
      } else if (!mimeTypes || mimeTypes.some((mt) => file.mimeType.startsWith(mt))) {
        allFiles.push({ ...file, folderId });
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

async function downloadFile(drive, fileId, destPath) {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    res.data.pipe(dest);
    dest.on('finish', resolve);
    dest.on('error', reject);
  });
}

async function renameFile(drive, fileId, newName) {
  await drive.files.update({
    fileId,
    requestBody: { name: newName },
  });
}

// Upload a markdown/text string as a Google Doc into a Drive folder.
// Drive auto-converts text/markdown -> Google Doc when mimeType is set on convert.
// Returns { id, webViewLink, name }.
async function uploadGoogleDoc(drive, folderId, name, markdownContent) {
  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document',
    },
    media: {
      mimeType: 'text/markdown',
      body: markdownContent,
    },
    fields: 'id, name, webViewLink',
  });
  // Make the doc viewable and editable by anyone with the link
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: {
      role: 'writer',
      type: 'anyone',
    },
  });
  return res.data;
}

module.exports = {
  getAuthClient,
  getDrive,
  findFolder,
  createFolder,
  ensureFolderPath,
  listFiles,
  downloadFile,
  renameFile,
  uploadGoogleDoc,
  ROOT_FOLDER_ID,
};
