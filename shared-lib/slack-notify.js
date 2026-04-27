// Shared Slack notification utility

const https = require('https');

function slackPost(body) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    console.log('[slack] No SLACK_BOT_TOKEN in env, skipping');
    return Promise.resolve({ ok: false, error: 'no_token' });
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ unfurl_links: false, ...body });
    const options = {
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: false, error: 'parse_error', raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendSlackMessage(channel, text) {
  return slackPost({ channel, text });
}

// Posts a reply in a thread. parentTs is the ts from the parent message response.
function sendSlackThread(channel, parentTs, text) {
  return slackPost({ channel, thread_ts: parentTs, text });
}

// Fetches replies in a thread. Returns array of messages (excluding the parent).
function getThreadReplies(channel, parentTs) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return Promise.resolve([]);

  return new Promise((resolve) => {
    const qs = `channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(parentTs)}&limit=10`;
    const req = https.request({
      hostname: 'slack.com',
      path: `/api/conversations.replies?${qs}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${slackToken}` },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Exclude the parent message (first item) and bot messages
          const replies = (parsed.messages || []).slice(1).filter(m => !m.bot_id && !m.subtype);
          resolve(replies);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

module.exports = { sendSlackMessage, sendSlackThread, getThreadReplies };
