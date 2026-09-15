(() => {
  const config = window.NAVIGATOR_CONFIG;
  const tokenKey = 'navigator.accessToken';
  const refreshTokenKey = 'navigator.refreshToken';
  const userNameKey = 'navigator.userName';
  const verifierKey = 'navigator.pkceVerifier';
  const returnPathKey = 'navigator.returnPath';
  const debugLogKey = 'navigator.authDebugLog';
  let accessToken = localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey);
  let refreshToken = localStorage.getItem(refreshTokenKey);
  let userName = localStorage.getItem(userNameKey) || sessionStorage.getItem(userNameKey) || '';
  let historyKeys = new Set();
  let refreshTimer = null;

  // Ring-buffer debug log (kept in localStorage) so auth issues can be
  // diagnosed after the fact via window.NavigatorAuth.getDebugLog().
  function logDebug(event, details) {
    const entry = { time: new Date().toISOString(), event, ...(details || {}) };
    console.debug(`[NavigatorAuth] ${entry.time} ${event}`, details || '');
    try {
      const log = JSON.parse(localStorage.getItem(debugLogKey) || '[]');
      log.push(entry);
      localStorage.setItem(debugLogKey, JSON.stringify(log.slice(-50)));
    } catch { /* Storage may be unavailable; logging is best-effort. */ }
  }

  function decodeJwtPayload(token) {
    try {
      const payload = token.split('.')[1];
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    } catch {
      return {};
    }
  }

  function getUserName(claims) {
    return claims.name || claims.preferred_username || claims.email || claims.nickname || 'felhasználó';
  }

  // Only used to show the username immediately; expiry is handled in initialize()
  // so an expired token can first try a silent refresh instead of forcing logout.
  if (accessToken && !userName) {
    userName = getUserName(decodeJwtPayload(accessToken));
  }

  function base64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function createCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64Url(new Uint8Array(digest));
  }

  function createVerifier() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function discover() {
    const response = await fetch(`${config.oidcIssuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    if (!response.ok) throw new Error('OIDC discovery failed');
    return response.json();
  }

  function redirectUri() {
    return `${window.location.origin}/`;
  }

  async function login() {
    if (!config.oidcClientId) throw new Error('OIDC client ID is not configured');
    const metadata = await discover();
    const verifier = createVerifier();
    const challenge = await createCodeChallenge(verifier);
    sessionStorage.setItem(verifierKey, verifier);
    const currentParams = new URLSearchParams(window.location.search);
    const returnPath = currentParams.has('code') || currentParams.has('error')
      ? window.location.pathname
      : `${window.location.pathname}${window.location.search}`;
    sessionStorage.setItem(returnPathKey, returnPath);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.oidcClientId,
      redirect_uri: redirectUri(),
      scope: 'openid profile email offline_access',
      state: verifier,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });
    logDebug('login.redirect');
    window.location.assign(`${metadata.authorization_endpoint}?${params}`);
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get('error');
    if (callbackError) {
      throw new Error(`OIDC authorization failed: ${callbackError}${params.get('error_description') ? ` (${params.get('error_description')})` : ''}`);
    }
    const code = params.get('code');
    if (!code) return;
    const verifier = sessionStorage.getItem(verifierKey);
    if (!verifier || params.get('state') !== verifier) throw new Error('Invalid OIDC state');
    const response = await fetch(`${config.apiBaseUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri(),
      })
    });
    const responseText = await response.text();
    if (!response.ok) {
      let details = responseText;
      try { details = JSON.stringify(JSON.parse(responseText)); } catch { /* Keep plain response text. */ }
      throw new Error(`OIDC token exchange failed (${response.status}): ${details || 'empty response'}`);
    }
    const tokens = JSON.parse(responseText);
    if (!tokens.access_token) throw new Error('OIDC token exchange returned no access token');
    applyTokens(tokens, 'login');
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(userNameKey);
    sessionStorage.removeItem(verifierKey);
    const returnPath = sessionStorage.getItem(returnPathKey) || window.location.pathname;
    sessionStorage.removeItem(returnPathKey);
    window.history.replaceState(null, '', returnPath);
  }

  function applyTokens(tokens, source) {
    accessToken = tokens.access_token;
    if (tokens.refresh_token) refreshToken = tokens.refresh_token;
    const claims = decodeJwtPayload(tokens.id_token || accessToken);
    userName = getUserName(claims);
    localStorage.setItem(tokenKey, accessToken);
    localStorage.setItem(userNameKey, userName);
    if (refreshToken) localStorage.setItem(refreshTokenKey, refreshToken);
    logDebug(`${source}.tokens_applied`, { exp: claims.exp, hasRefreshToken: Boolean(refreshToken) });
    scheduleRefresh(claims.exp);
  }

  function scheduleRefresh(exp) {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (!exp || !refreshToken) return;
    // Refresh 60s before expiry so the API never sees an expired token.
    const delay = Math.max(exp * 1000 - Date.now() - 60000, 5000);
    refreshTimer = setTimeout(() => { refreshAccessToken().catch(error => logDebug('refresh.scheduled_failed', { message: error.message })); }, delay);
    logDebug('refresh.scheduled', { delayMs: delay });
  }

  async function refreshAccessToken() {
    if (!refreshToken) throw new Error('No refresh token available');
    logDebug('refresh.attempt');
    const response = await fetch(`${config.apiBaseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refreshToken })
    });
    const responseText = await response.text();
    if (!response.ok) {
      logDebug('refresh.failed', { status: response.status, body: responseText.slice(0, 300) });
      throw new Error(`Refresh failed (${response.status}): ${responseText}`);
    }
    const tokens = JSON.parse(responseText);
    applyTokens(tokens, 'refresh');
    document.dispatchEvent(new CustomEvent('navigator-auth-updated'));
    return accessToken;
  }

  // Background tabs can have their setTimeout throttled or suspended, so also
  // check on return-to-foreground instead of relying on the timer alone.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !accessToken) return;
    const claims = decodeJwtPayload(accessToken);
    if (claims.exp && claims.exp * 1000 - Date.now() < 60000) {
      refreshAccessToken().catch(error => {
        logDebug('visibilitychange.refresh_failed', { message: error.message });
        logout(false);
      });
    }
  });

  async function api(path, options = {}, retried = false) {
    if (!accessToken) return null;
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    if (response.status === 401) {
      logDebug('api.unauthorized', { path, retried });
      if (!retried && refreshToken) {
        try {
          await refreshAccessToken();
          return api(path, options, true);
        } catch (error) {
          logDebug('api.refresh_after_401_failed', { message: error.message });
        }
      }
      logout(false);
      return null;
    }
    if (!response.ok) throw new Error(`API request failed: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  async function loadHistory() {
    const result = await api('/api/history');
    historyKeys = new Set((result?.history || []).map(entry => `${entry.navigator}:${entry.work}:${entry.item}`));
    return historyKeys;
  }

  function hasVisited(navigator, work, item) {
    return historyKeys.has(`${navigator}:${work}:${item}`);
  }

  async function recordVisit(navigator, work, item) {
    if (!accessToken) return;
    historyKeys.add(`${navigator}:${work}:${item}`);
    document.dispatchEvent(new CustomEvent('navigator-history-updated'));
    try {
      await api('/api/history', {
        method: 'POST',
        body: JSON.stringify({ navigator, work, item })
      });
    } catch (error) {
      console.error(error);
    }
  }

  function logout(redirect = true) {
    logDebug('logout', { redirect });
    accessToken = null;
    refreshToken = null;
    userName = '';
    historyKeys = new Set();
    if (refreshTimer) clearTimeout(refreshTimer);
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(refreshTokenKey);
    localStorage.removeItem(userNameKey);
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(userNameKey);
    document.dispatchEvent(new CustomEvent('navigator-auth-updated'));
    if (redirect) window.location.reload();
  }

  async function initialize() {
    try {
      await handleCallback();
      if (accessToken) {
        const claims = decodeJwtPayload(accessToken);
        const expiringSoon = !claims.exp || claims.exp * 1000 - Date.now() < 60000;
        if (expiringSoon && refreshToken) {
          logDebug('startup.silent_refresh', { exp: claims.exp });
          await refreshAccessToken().catch(error => {
            logDebug('startup.silent_refresh_failed', { message: error.message });
            logout(false);
          });
        } else if (expiringSoon) {
          logDebug('startup.access_token_expired_no_refresh_token', { exp: claims.exp });
          logout(false);
        } else {
          scheduleRefresh(claims.exp);
        }
      }
      await loadHistory();
    } catch (error) {
      logDebug('initialize.failed', { message: error.message });
      document.dispatchEvent(new CustomEvent('navigator-auth-error', { detail: error.message }));
    }
    document.dispatchEvent(new CustomEvent('navigator-auth-ready'));
  }

  window.NavigatorAuth = {
    login: () => login().catch(error => {
      logDebug('login.failed', { message: error.message });
      document.dispatchEvent(new CustomEvent('navigator-auth-error', { detail: error.message }));
    }),
    logout,
    hasVisited,
    loadHistory,
    recordVisit,
    getDebugLog: () => { try { return JSON.parse(localStorage.getItem(debugLogKey) || '[]'); } catch { return []; } },
    getUserName: () => userName,
    isAuthenticated: () => Boolean(accessToken)
  };

  initialize();
})();
