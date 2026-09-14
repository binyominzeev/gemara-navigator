(() => {
  const config = window.NAVIGATOR_CONFIG;
  const tokenKey = 'navigator.accessToken';
  const verifierKey = 'navigator.pkceVerifier';
  const returnPathKey = 'navigator.returnPath';
  let accessToken = sessionStorage.getItem(tokenKey);
  let historyKeys = new Set();

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
    sessionStorage.setItem(returnPathKey, `${window.location.pathname}${window.location.search}`);
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
    const code = params.get('code');
    if (!code) return;
    const verifier = sessionStorage.getItem(verifierKey);
    if (!verifier || params.get('state') !== verifier) throw new Error('Invalid OIDC state');
    const metadata = await discover();
    const response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.oidcClientId,
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier
      })
    });
    if (!response.ok) throw new Error('OIDC token exchange failed');
    const tokens = await response.json();
    accessToken = tokens.access_token;
    sessionStorage.setItem(tokenKey, accessToken);
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
    historyKeys = new Set();
    sessionStorage.removeItem(tokenKey);
    document.dispatchEvent(new CustomEvent('navigator-auth-updated'));
    if (redirect) window.location.reload();
  }

  async function initialize() {
    try {
      await handleCallback();
      await loadHistory();
    } catch (error) {
      console.error(error);
      logout(false);
    }
    document.dispatchEvent(new CustomEvent('navigator-auth-ready'));
  }

  window.NavigatorAuth = {
    login,
    logout,
    hasVisited,
    loadHistory,
    recordVisit,
    isAuthenticated: () => Boolean(accessToken)
  };

  initialize();
})();
