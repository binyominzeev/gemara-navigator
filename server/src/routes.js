import { Router } from 'express';
import { getHistory, recordHistory } from './db.js';
import { requireAuth } from './auth.js';

const router = Router();
const validNavigators = new Set(['gemara', 'tursa']);
const maxHistoryEntries = 500;

router.post('/auth/token', async (req, res, next) => {
  const { code, code_verifier: codeVerifier, redirect_uri: redirectUri } = req.body || {};
  const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, '');
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const configuredRedirectUri = process.env.OIDC_REDIRECT_URI;

  if (!issuer || !clientId || !clientSecret || !configuredRedirectUri) {
    return res.status(503).json({ error: 'OIDC server configuration is incomplete' });
  }
  if (
    typeof code !== 'string' ||
    typeof codeVerifier !== 'string' ||
    redirectUri !== configuredRedirectUri
  ) {
    return res.status(400).json({ error: 'Invalid OIDC token request' });
  }

  try {
    const tokenResponse = await fetch(`${issuer}/api/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: configuredRedirectUri,
        code_verifier: codeVerifier
      })
    });
    const responseText = await tokenResponse.text();
    res.status(tokenResponse.status).type('application/json').send(responseText);
  } catch (error) {
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
