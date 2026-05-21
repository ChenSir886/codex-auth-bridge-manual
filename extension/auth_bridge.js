(function attachCodexAuthBridge(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.CodexAuthBridge = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function createCodexAuthBridge() {
  'use strict';

  const SESSION_ENDPOINT = 'https://chatgpt.com/api/auth/session';
  const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';

  function decodeBase64Url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '==='.slice((base64.length + 3) % 4);

    if (typeof atob === 'function') {
      return atob(padded);
    }

    return Buffer.from(padded, 'base64').toString('binary');
  }

  function decodeJwtPayload(token) {
    if (typeof token !== 'string' || token.length === 0) {
      throw new TypeError('accessToken 为空，无法生成 auth.json。');
    }

    const segments = token.split('.');
    if (segments.length < 2) {
      throw new Error('accessToken 不是有效的 JWT 格式。');
    }

    try {
      return JSON.parse(decodeBase64Url(segments[1]));
    } catch (error) {
      throw new Error('无法解析 accessToken 的 JWT payload。');
    }
  }

  function resolveAccountId(payload, fallbackAccountId) {
    const claim = payload && payload[OPENAI_AUTH_CLAIM];

    if (claim && typeof claim.chatgpt_account_id === 'string' && claim.chatgpt_account_id) {
      return claim.chatgpt_account_id;
    }

    if (typeof fallbackAccountId === 'string' && fallbackAccountId) {
      return fallbackAccountId;
    }

    throw new Error('未找到 account_id，请确认当前 ChatGPT 登录态有效。');
  }

  function resolveEmail(payload, fallbackEmail) {
    if (typeof fallbackEmail === 'string' && fallbackEmail) {
      return fallbackEmail;
    }

    const profile = payload && payload['https://api.openai.com/profile'];
    if (profile && typeof profile.email === 'string' && profile.email) {
      return profile.email;
    }

    return null;
  }

  function readPath(value, path) {
    return path.reduce((current, key) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }

      return current[key];
    }, value);
  }

  function firstString(value, paths) {
    for (const path of paths) {
      const candidate = Array.isArray(path) ? readPath(value, path) : value[path];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  }

  function parseManualInput(input) {
    if (typeof input !== 'string' || input.trim().length === 0) {
      throw new Error('请粘贴 session JSON、auth.json 或 accessToken。');
    }

    const trimmed = input.trim();

    if (!trimmed.startsWith('{')) {
      return {
        accessToken: trimmed,
        source: {}
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error('手动输入不是有效 JSON，也不像 accessToken。');
    }

    const source = parsed && typeof parsed.auth === 'object' ? parsed.auth : parsed;
    const accessToken = firstString(source, [
      'accessToken',
      'access_token',
      'id_token',
      ['tokens', 'access_token'],
      ['tokens', 'id_token']
    ]);

    if (!accessToken) {
      throw new Error('输入内容里没有找到 accessToken。');
    }

    return {
      accessToken,
      source
    };
  }

  function sessionDataFromManualInput(input, options = {}) {
    const { accessToken, source } = parseManualInput(input);
    const accountId = options.accountId || firstString(source, [
      'account_id',
      'accountId',
      ['account', 'id'],
      ['tokens', 'account_id']
    ]);
    const email = options.email || firstString(source, [
      'email',
      ['user', 'email'],
      ['meta', 'email']
    ]);
    const planType = options.planType || firstString(source, [
      'planType',
      ['account', 'planType'],
      ['meta', 'planType']
    ]);
    const expires = options.expires || firstString(source, [
      'expires',
      ['meta', 'sessionExpiresAt']
    ]);

    return {
      accessToken,
      expires,
      user: {
        email
      },
      account: {
        id: accountId,
        planType
      }
    };
  }

  async function fetchSession(fetchImpl) {
    const fetcher = fetchImpl || (typeof fetch === 'function' ? fetch : null);

    if (!fetcher) {
      throw new Error('当前环境不支持 fetch。');
    }

    const response = await fetcher(SESSION_ENDPOINT, {
      credentials: 'include',
      headers: {
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('ChatGPT 登录态不可用，请先在浏览器里重新登录 chatgpt.com。');
    }

    if (!response.ok) {
      throw new Error(`请求 ChatGPT session 失败：HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || typeof data !== 'object') {
      throw new Error('ChatGPT session 返回值不是有效的 JSON 对象。');
    }

    if (typeof data.accessToken !== 'string' || data.accessToken.length === 0) {
      throw new Error('ChatGPT session 中没有 accessToken。');
    }

    return data;
  }

  function isoFromEpochSeconds(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
      return null;
    }

    return new Date(seconds * 1000).toISOString();
  }

  function buildAuthJson(sessionData, options = {}) {
    if (!sessionData || typeof sessionData.accessToken !== 'string') {
      throw new Error('sessionData 缺少 accessToken。');
    }

    const accessToken = sessionData.accessToken;
    const payload = decodeJwtPayload(accessToken);
    const accountId = resolveAccountId(payload, sessionData.account && sessionData.account.id);
    const lastRefresh = options.lastRefresh || new Date().toISOString();

    return {
      auth: {
        OPENAI_API_KEY: null,
        auth_mode: 'chatgpt',
        last_refresh: lastRefresh,
        tokens: {
          id_token: accessToken,
          access_token: accessToken,
          refresh_token: '',
          account_id: accountId
        }
      },
      meta: {
        email: resolveEmail(payload, sessionData.user && sessionData.user.email),
        planType: (sessionData.account && sessionData.account.planType) || null,
        accountId,
        accessTokenExpiresAt: isoFromEpochSeconds(payload.exp),
        sessionExpiresAt: typeof sessionData.expires === 'string' ? sessionData.expires : null
      }
    };
  }

  async function buildFromBrowser(fetchImpl) {
    return buildAuthJson(await fetchSession(fetchImpl));
  }

  function buildFromManualInput(input, options = {}) {
    return buildAuthJson(sessionDataFromManualInput(input, options), options);
  }

  return Object.freeze({
    OPENAI_AUTH_CLAIM,
    SESSION_ENDPOINT,
    buildAuthJson,
    buildFromBrowser,
    buildFromManualInput,
    decodeJwtPayload,
    fetchSession,
    parseManualInput,
    resolveAccountId
  });
});
