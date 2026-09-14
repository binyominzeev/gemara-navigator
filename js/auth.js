(() => {
  const config = window.NAVIGATOR_CONFIG;
  const tokenKey = 'navigator.accessToken';
  const verifierKey = 'navigator.pkceVerifier';
  const returnPathKey = 'navigator.returnPath';
  let accessToken = localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey);
  let userName = localStorage.getItem('navigator.userName') || sessionStorage.getItem('navigator.userName') || '';
  let historyKeys = new Set();

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

  if (accessToken) {
    const claims = decodeJwtPayload(accessToken);
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      accessToken = null;
      userName = '';
      localStorage.removeItem(tokenKey);
      localStorage.removeItem('navigator.userName');
    } else if (!userName) {
      userName = getUserName(claims);
    }
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
      scope: 'openid profile email',
      state: verifier,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });
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
    accessToken = tokens.access_token;
    const claims = decodeJwtPayload(tokens.id_token || accessToken);
    userName = getUserName(claims);
    localStorage.setItem(tokenKey, accessToken);
    localStorage.setItem('navigator.userName', userName);
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem('navigator.userName');
    sessionStorage.removeItem(verifierKey);
    const returnPath = sessionStorage.getItem(returnPathKey) || window.location.pathname;
    sessionStorage.removeItem(returnPathKey);
    window.history.replaceState(null, '', returnPath);
  }

  async function api(path, options = {}) {
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
    accessToken = null;
    userName = '';
    historyKeys = new Set();
    localStorage.removeItem(tokenKey);
    localStorage.removeItem('navigator.userName');
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem('navigator.userName');
    document.dispatchEvent(new CustomEvent('navigator-auth-updated'));
    if (redirect) window.location.reload();
  }

  async function initialize() {
    try {
      await handleCallback();
      await loadHistory();
    } catch (error) {
      console.error(error);
      document.dispatchEvent(new CustomEvent('navigator-auth-error', { detail: error.message }));
    }
    document.dispatchEvent(new CustomEvent('navigator-auth-ready'));
  }

  window.NavigatorAuth = {
    login: () => login().catch(error => {
      console.error(error);
      document.dispatchEvent(new CustomEvent('navigator-auth-error', { detail: error.message }));
    }),
    logout,
    hasVisited,
    loadHistory,
    recordVisit,
    getUserName: () => userName,
    isAuthenticated: () => Boolean(accessToken)
  };

  initialize();
})();
