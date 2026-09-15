import { Router } from 'express';
import { getHistory, recordHistory } from './db.js';
import { requireAuth } from './auth.js';

const router = Router();
const validNavigators = new Set(['gemara', 'tursa']);
const maxHistoryEntries = 500;

// Structured auth logging: PM2 captures stdout/stderr into
// ~/.pm2/logs/gemara-navigator-api-out.log / -error.log, so this
// doubles as the persistent debug log without adding a new file.
function logAuthEvent(event, details) {
  console.log(`[auth] ${new Date().toISOString()} ${event}`, JSON.stringify(details));
}

async function exchangeWithPocketId(grantParams) {
  const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, '');
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) return { status: 503, body: JSON.stringify({ error: 'OIDC server configuration is incomplete' }) };

  const response = await fetch(`${issuer}/api/oidc/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...grantParams })
  });
  return { status: response.status, body: await response.text() };
}

router.post('/auth/token', async (req, res, next) => {
  const { code, code_verifier: codeVerifier, redirect_uri: redirectUri } = req.body || {};
  const configuredRedirectUri = process.env.OIDC_REDIRECT_URI;

  if (!configuredRedirectUri) {
    logAuthEvent('token.config_missing', {});
    return res.status(503).json({ error: 'OIDC server configuration is incomplete' });
  }
  if (
    typeof code !== 'string' ||
    typeof codeVerifier !== 'string' ||
    redirectUri !== configuredRedirectUri
  ) {
    logAuthEvent('token.invalid_request', { hasCode: typeof code === 'string', redirectUriMatches: redirectUri === configuredRedirectUri });
    return res.status(400).json({ error: 'Invalid OIDC token request' });
  }

  try {
    const { status, body } = await exchangeWithPocketId({
      grant_type: 'authorization_code',
      code,
      redirect_uri: configuredRedirectUri,
      code_verifier: codeVerifier
    });
    logAuthEvent(status === 200 ? 'token.success' : 'token.failed', { status });
    res.status(status).type('application/json').send(body);
  } catch (error) {
    logAuthEvent('token.error', { message: error.message });
    next(error);
  }
});

router.post('/auth/refresh', async (req, res, next) => {
  const { refresh_token: refreshToken } = req.body || {};
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    logAuthEvent('refresh.invalid_request', {});
    return res.status(400).json({ error: 'Invalid refresh request' });
  }

  try {
    const { status, body } = await exchangeWithPocketId({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    logAuthEvent(status === 200 ? 'refresh.success' : 'refresh.failed', { status });
    res.status(status).type('application/json').send(body);
  } catch (error) {
    logAuthEvent('refresh.error', { message: error.message });
    next(error);
  }
});

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

router.get('/history', requireAuth, (req, res) => {
  res.json({ history: getHistory(req.user.id) });
});

router.post('/history', requireAuth, (req, res) => {
  const { navigator, work, item } = req.body || {};
  const parsedItem = Number(item);

  if (
    !validNavigators.has(navigator) ||
    typeof work !== 'string' ||
    work.length < 1 ||
    work.length > 100 ||
    !Number.isInteger(parsedItem) ||
    parsedItem < 1 ||
    parsedItem > maxHistoryEntries
  ) {
    return res.status(400).json({ error: 'Invalid history entry' });
  }

  recordHistory({
    userId: req.user.id,
    navigator,
    work,
    item: parsedItem,
    lastOpenedAt: new Date().toISOString()
  });

  return res.status(204).end();
});

export default router;
