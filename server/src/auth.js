import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, '');
const audience = process.env.OIDC_AUDIENCE || undefined;
const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

export async function requireAuth(req, res, next) {
  if (!issuer || !jwks) {
    return res.status(503).json({ error: 'Authentication is not configured' });
  }

  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Bearer token required' });
  }

  try {
    const verification = await jwtVerify(match[1], jwks, {
      issuer,
      ...(audience ? { audience } : {})
    });
    const userId = verification.payload.sub;
    if (typeof userId !== 'string' || userId.length === 0) {
      return res.status(401).json({ error: 'Token has no subject' });
    }
    req.user = { id: userId, claims: verification.payload };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }
}
