// -----------------------------------------------------------------------------
// The Navimow account: the OAuth2 authorization-code flow of Segway's own
// Home Assistant integration (NavimowHA: authorize page, token endpoint,
// client), the token kept with its expiry, and its renewal.
//
// The token endpoint takes a form (grant_type, code or refresh_token,
// client_id, client_secret, redirect_uri) and answers the standard OAuth2
// JSON ({ access_token, refresh_token, expires_in, token_type }); a refused
// code or refresh token is HTTP 400 {"error":"invalid_grant"} (probed
// 2026-10-16). The token is stored by the app (a config key outside the
// config_schema, see src/app.js); this file never logs it.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import {
  API_URL,
  HTTP_TIMEOUT,
  OAUTH,
  PATHS,
  STATE_TTL,
  TOKEN_MARGIN,
  TOKEN_RETRY,
} from '../constants.js';
import { HttpError, request } from '../http.js';

/** What went wrong, for the status messages: see NavimowError.code. */
export class NavimowError extends Error {
  /**
   * @param {'refused'|'token'|'no_token'|'unreachable'|'api'|'command'|'state'|'unknown_mower'} code
   * @param {string} message never a token
   */
  constructor(code, message, { status, apiCode } = {}) {
    super(message);
    this.name = 'NavimowError';
    this.code = code;
    this.status = status;
    this.apiCode = apiCode;
  }
}

/** A readable reason for a failed request (never a header, a token or a query string). */
export function reasonOf(err) {
  if (err instanceof NavimowError) {
    return err.message;
  }
  if (err instanceof HttpError) {
    const body = err.body;
    let detail = '';
    if (body && typeof body === 'object') {
      detail = body.error_description ?? body.error ?? body.desc ?? '';
    } else if (typeof body === 'string') {
      // A gateway answers with an HTML page: its title says it all.
      detail = (/<title>([^<]*)<\/title>/i.exec(body)?.[1] ?? body).replace(/\s+/g, ' ').trim();
    }
    return `${err.message}${detail ? `: ${String(detail).slice(0, 120)}` : ''}`;
  }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return 'timeout';
  }
  const cause = err?.cause?.code ?? err?.code;
  return String(cause ?? err?.message ?? err).slice(0, 160);
}

/** The token answer -> the token kept: { accessToken, refreshToken, expiresAt, obtainedAt }. */
export function tokenOf(data, now) {
  const body = data?.access_token ? data : data?.data?.access_token ? data.data : null;
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    return null;
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    // Without an expiry, an hour (what the references renew at): a refused
    // call renews it earlier anyway.
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    obtainedAt: now,
  };
}

/** The stored form of a token (a config value) -> the token, or null. */
export function tokenFromStore(value) {
  let token = value;
  if (typeof token === 'string') {
    try {
      token = JSON.parse(token);
    } catch {
      return null;
    }
  }
  if (!token || typeof token !== 'object' || typeof token.access_token !== 'string') {
    return null;
  }
  return {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null,
    expiresAt: Number(token.expires_at) || 0,
    obtainedAt: Number(token.obtained_at) || 0,
  };
}

/** The token -> its stored form (snake_case keys, epoch milliseconds). */
export const tokenToStore = (token) => ({
  access_token: token.accessToken,
  refresh_token: token.refreshToken,
  expires_at: token.expiresAt,
  obtained_at: token.obtainedAt,
});

/** The code of a pasted address ("http://localhost:1/callback?code=…"), or the code itself. */
export function codeFromInput(input) {
  const value = String(input ?? '').trim();
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).searchParams.get('code') || null;
    } catch {
      return null;
    }
  }
  const match = /(?:^|[?&])code=([^&#\s]+)/.exec(value);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return /^[A-Za-z0-9._~-]+$/.test(value) ? value : null;
}

export class NavimowAuth {
  constructor({ apiUrl = API_URL, now = Date.now, onToken = async () => {} } = {}) {
    this.apiUrl = apiUrl;
    this.now = now;
    /** Called with every new token, to store it. */
    this.onToken = onToken;
    this.token = null;
    /** The anti-CSRF states handed out by the Connect button: state -> created at. */
    this.states = new Map();
    /** Set when Navimow refused the refresh token: a new sign-in is needed. */
    this.refused = false;
    this.renewing = undefined;
    /** Failed renewals in a row (network), when to try again, and why it failed. */
    this.failures = 0;
    this.retryAt = 0;
    this.lastFailure = undefined;
  }

  get signedIn() {
    return Boolean(this.token?.accessToken);
  }

  /** Take a stored token (at start, or when Gladys sends the config back). */
  load(token) {
    if (!token) {
      return;
    }
    // A token we renewed since is newer than the one Gladys sends back.
    if (!this.token || token.obtainedAt > this.token.obtainedAt) {
      this.token = token;
      this.refused = false;
    }
  }

  forget() {
    this.token = null;
    this.refused = false;
  }

  // --- The Connect button -------------------------------------------------------------

  /** The sign-in page for `redirectUri`, with a fresh anti-CSRF state. */
  authorizeUrl(redirectUri) {
    const now = this.now();
    for (const [state, at] of this.states) {
      if (now - at > STATE_TTL) {
        this.states.delete(state);
      }
    }
    // Two clicks on Connect leave two valid states; a dozen is a bug or a
    // flood: forget the oldest.
    while (this.states.size >= 10) {
      this.states.delete(this.states.keys().next().value);
    }
    const state = randomBytes(16).toString('hex');
    this.states.set(state, now);
    const url = new URL(OAUTH.AUTHORIZE_URL);
    url.searchParams.set('channel', OAUTH.CHANNEL);
    url.searchParams.set('client_id', OAUTH.CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** Is `state` one we handed out (and still valid)? It can serve once. */
  takeState(state) {
    const at = this.states.get(state);
    this.states.delete(state);
    return at !== undefined && this.now() - at <= STATE_TTL;
  }

  // --- Tokens ---------------------------------------------------------------------------

  async tokenRequest(form, timeout) {
    let response;
    try {
      response = await request(`${this.apiUrl}${PATHS.TOKEN}`, {
        method: 'POST',
        form: true,
        body: { ...form, client_id: OAUTH.CLIENT_ID, client_secret: OAUTH.CLIENT_SECRET },
        timeout,
      });
    } catch (err) {
      if (err instanceof HttpError && [400, 401, 403].includes(err.status)) {
        const reason = err.body?.error_description ?? err.body?.error ?? `HTTP ${err.status}`;
        throw new NavimowError('refused', `Navimow refused the sign-in (${reason})`, {
          status: err.status,
        });
      }
      throw new NavimowError('unreachable', reasonOf(err), { status: err?.status });
    }
    const token = tokenOf(response.data, this.now());
    if (!token) {
      const reason = response.data?.error ?? response.data?.desc ?? 'no access token';
      throw new NavimowError('refused', `Navimow refused the sign-in (${reason})`);
    }
    return token;
  }

  /** Exchange an authorization code (the Connect callback or a pasted address). */
  async exchangeCode(code, redirectUri, { timeout = HTTP_TIMEOUT } = {}) {
    const token = await this.tokenRequest(
      { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
      timeout,
    );
    await this.accept(token, 'sign_in');
    return token;
  }

  /** Keep a new token and hand it to `onToken` (to store it); `reason`: sign_in | renew. */
  async accept(token, reason) {
    // A refresh answer may come without a new refresh token: keep the old one.
    if (!token.refreshToken && this.token?.refreshToken) {
      token.refreshToken = this.token.refreshToken;
    }
    this.token = token;
    this.refused = false;
    this.failures = 0;
    this.retryAt = 0;
    this.lastFailure = undefined;
    await this.onToken(token, reason);
  }

  /** Renew the token with the refresh token (one renewal at a time). */
  renew() {
    if (!this.renewing) {
      this.renewing = this.doRenew().finally(() => {
        this.renewing = undefined;
      });
    }
    return this.renewing;
  }

  async doRenew() {
    if (!this.token) {
      throw new NavimowError('no_token', 'Not signed in to Navimow');
    }
    if (!this.token.refreshToken) {
      this.refused = true;
      throw new NavimowError('refused', 'The Navimow session expired and cannot be renewed');
    }
    try {
      const token = await this.tokenRequest(
        { grant_type: 'refresh_token', refresh_token: this.token.refreshToken },
        HTTP_TIMEOUT,
      );
      await this.accept(token, 'renew');
      return token;
    } catch (err) {
      if (err.code === 'refused') {
        this.refused = true;
      }
      throw err;
    }
  }

  /** Does the token need renewing (expired, or within the margin)? */
  get expiring() {
    return Boolean(this.token) && this.now() >= this.token.expiresAt - TOKEN_MARGIN;
  }

  /** Has the token expired? */
  get expired() {
    return Boolean(this.token) && this.now() >= this.token.expiresAt;
  }

  /**
   * Renew the token when it is due and no failed renewal asks to wait: a
   * network failure is tried again after 1, 5, 15 then 60 minutes
   * (TOKEN_RETRY), whatever asks for the token meanwhile. A refusal throws.
   */
  async renewIfDue() {
    if (!this.expiring || this.now() < this.retryAt) {
      return;
    }
    try {
      await this.renew();
    } catch (err) {
      if (err.code === 'refused' || err.code === 'no_token') {
        throw err;
      }
      const delay = TOKEN_RETRY[Math.min(this.failures, TOKEN_RETRY.length - 1)];
      this.failures += 1;
      this.retryAt = this.now() + delay;
      this.lastFailure = err;
    }
  }

  /** A usable access token: the current one, renewed first when it is about to expire. */
  async accessToken() {
    if (!this.token) {
      throw new NavimowError('no_token', 'Not signed in to Navimow');
    }
    if (this.refused) {
      throw new NavimowError('refused', 'The Navimow session expired: sign in again');
    }
    await this.renewIfDue();
    if (this.expired) {
      // A failed renewal: the old token still works until it expires.
      throw new NavimowError(
        'unreachable',
        `the Navimow session could not be renewed (${reasonOf(this.lastFailure)})`,
      );
    }
    return this.token.accessToken;
  }
}
