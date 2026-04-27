const crypto = require('crypto');
const config = require('./config');

const COOKIE_NAME = 'terminal_auth';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function parseCookies(req, res, next) {
  req.cookies = {};
  const header = req.headers.cookie || '';
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('='));
  }
  next();
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.cookieSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', config.cookieSecret).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const payload = verifyToken(req.cookies[COOKIE_NAME]);
  if (payload && payload.authed) {
    req.user = payload;
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login');
}

function mountAuthRoutes(app) {
  app.get('/login', (req, res) => {
    res.sendFile(require('path').join(__dirname, '..', 'public', 'login.html'));
  });

  app.post('/login', (req, res) => {
    if (req.body.password === config.dashboardPassword) {
      const token = signToken({ authed: true, user: 'noa', ts: Date.now() });
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`);
      return res.redirect('/');
    }
    return res.redirect('/login?error=1');
  });

  app.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
    res.redirect('/login');
  });
}

module.exports = { parseCookies, requireAuth, mountAuthRoutes };
