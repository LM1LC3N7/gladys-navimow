// -----------------------------------------------------------------------------
// The Navimow account (src/navimow/auth.js): the sign-in page, the state,
// the code exchange, the renewal and the stored form of the token.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NavimowAuth,
  NavimowError,
  codeFromInput,
  reasonOf,
  tokenFromStore,
  tokenOf,
  tokenToStore,
} from '../src/navimow/auth.js';
import { HttpError } from '../src/http.js';
import { MANUAL_SIGN_IN_URL, OAUTH, STATE_TTL, TOKEN_MARGIN } from '../src/constants.js';
import { FIXTURE_NOW, RENEWED, TOKEN, installNavimow, json } from './helpers/fakeNavimow.js';

let fake;
afterEach(() => fake?.restore());

const REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';

function setup(overrides) {
  fake = installNavimow(overrides);
  const clock = { now: FIXTURE_NOW };
  const stored = [];
  const auth = new NavimowAuth({
    now: () => clock.now,
    onToken: async (token, reason) => stored.push({ token: { ...token }, reason }),
  });
  return { auth, clock, stored };
}

test('the sign-in page carries the client, the redirect and a fresh state', () => {
  const { auth } = setup();
  const url = new URL(auth.authorizeUrl(REDIRECT));
  assert.equal(`${url.origin}${url.pathname}`, OAUTH.AUTHORIZE_URL);
  assert.equal(url.searchParams.get('channel'), 'homeassistant');
  assert.equal(url.searchParams.get('client_id'), 'homeassistant');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  const state = url.searchParams.get('state');
  assert.match(state, /^[0-9a-f]{32}$/);
  assert.equal(url.searchParams.get('client_secret'), null, 'the secret never goes to the browser');
  const other = new URL(auth.authorizeUrl(REDIRECT)).searchParams.get('state');
  assert.notEqual(other, state);
  // Each state serves once.
  assert.equal(auth.takeState(state), true);
  assert.equal(auth.takeState(state), false);
  assert.equal(auth.takeState('forged'), false);
  assert.equal(auth.takeState(undefined), false);
});

test('a state expires, and a flood of clicks keeps only the last ten', () => {
  const { auth, clock } = setup();
  const old = new URL(auth.authorizeUrl(REDIRECT)).searchParams.get('state');
  clock.now += STATE_TTL + 1;
  assert.equal(auth.takeState(old), false);
  const states = [];
  for (let i = 0; i < 12; i += 1) {
    states.push(new URL(auth.authorizeUrl(REDIRECT)).searchParams.get('state'));
  }
  assert.equal(auth.states.size, 10);
  assert.equal(auth.takeState(states[0]), false);
  assert.equal(auth.takeState(states[11]), true);
});

test('the manual sign-in link is the sign-in page with the localhost redirect', () => {
  const url = new URL(MANUAL_SIGN_IN_URL);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:1/callback');
  assert.equal(url.searchParams.get('state'), null);
});

test('a code is exchanged with the client and the same redirect, and stored', async () => {
  const { auth, stored } = setup();
  const token = await auth.exchangeCode('good-code', REDIRECT);
  assert.equal(token.accessToken, TOKEN.access_token);
  assert.equal(token.refreshToken, TOKEN.refresh_token);
  assert.equal(token.expiresAt, FIXTURE_NOW + 3600 * 1000);
  const [call] = fake.to('/openapi/oauth/getAccessToken');
  assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(call.body, {
    grant_type: 'authorization_code',
    code: 'good-code',
    redirect_uri: REDIRECT,
    client_id: 'homeassistant',
    client_secret: OAUTH.CLIENT_SECRET,
  });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].reason, 'sign_in');
  assert.equal(auth.signedIn, true);
});

test('a used or unknown code is refused (the real invalid_grant answer)', async () => {
  const { auth, stored } = setup();
  await assert.rejects(auth.exchangeCode('bad-code', REDIRECT), (err) => {
    assert.ok(err instanceof NavimowError);
    assert.equal(err.code, 'refused');
    assert.match(err.message, /invalid_grant/);
    return true;
  });
  assert.equal(stored.length, 0);
  assert.equal(auth.signedIn, false);
});

test('a token endpoint that is down is "unreachable", not "refused"', async () => {
  const { auth } = setup();
  fake.state.fail.set('getAccessToken', json('<html><title>502 Bad Gateway</title></html>', 502));
  await assert.rejects(auth.exchangeCode('good-code', REDIRECT), { code: 'unreachable' });
  fake.state.fail.set('getAccessToken', new TypeError('fetch failed'));
  await assert.rejects(auth.exchangeCode('good-code', REDIRECT), { code: 'unreachable' });
  fake.state.fail.set('getAccessToken', json({ desc: 'odd' }));
  await assert.rejects(auth.exchangeCode('good-code', REDIRECT), { code: 'refused' });
});

test('the token is renewed before it expires, and a renewal is kept', async () => {
  const { auth, clock, stored } = setup();
  await auth.exchangeCode('good-code', REDIRECT);
  assert.equal(await auth.accessToken(), TOKEN.access_token);
  assert.equal(fake.to('getAccessToken').length, 1);
  clock.now += 3600 * 1000 - TOKEN_MARGIN;
  assert.equal(auth.expiring, true);
  assert.equal(await auth.accessToken(), RENEWED.access_token);
  const renew = fake.to('getAccessToken')[1];
  assert.deepEqual(renew.body, {
    grant_type: 'refresh_token',
    refresh_token: TOKEN.refresh_token,
    client_id: 'homeassistant',
    client_secret: OAUTH.CLIENT_SECRET,
  });
  assert.equal(stored.at(-1).reason, 'renew');
  assert.equal(auth.token.refreshToken, RENEWED.refresh_token);
});

test('concurrent renewals make one call', async () => {
  const { auth } = setup();
  await auth.exchangeCode('good-code', REDIRECT);
  await Promise.all([auth.renew(), auth.renew(), auth.renew()]);
  assert.equal(fake.to('getAccessToken').length, 2);
});

test('a renewal without a new refresh token keeps the previous one', async () => {
  const { auth } = setup();
  await auth.exchangeCode('good-code', REDIRECT);
  fake.state.refreshTokens.set(TOKEN.refresh_token, {
    access_token: 'only-access',
    expires_in: 60,
  });
  await auth.renew();
  assert.equal(auth.token.accessToken, 'only-access');
  assert.equal(auth.token.refreshToken, TOKEN.refresh_token);
});

test('a refused refresh token asks for a new sign-in', async () => {
  const { auth, clock } = setup();
  await auth.exchangeCode('good-code', REDIRECT);
  fake.state.refreshTokens.clear();
  clock.now += 3600 * 1000;
  await assert.rejects(auth.accessToken(), { code: 'refused' });
  assert.equal(auth.refused, true);
  await assert.rejects(auth.accessToken(), { code: 'refused' });
  assert.equal(fake.to('getAccessToken').length, 2, 'no more calls once refused');
});

test('a network failure keeps a token that still works, not an expired one', async () => {
  const { auth, clock } = setup();
  await auth.exchangeCode('good-code', REDIRECT);
  fake.state.fail.set('getAccessToken', new TypeError('fetch failed'));
  clock.now += 3600 * 1000 - TOKEN_MARGIN + 1;
  assert.equal(await auth.accessToken(), TOKEN.access_token);
  clock.now += TOKEN_MARGIN;
  await assert.rejects(auth.accessToken(), { code: 'unreachable' });
  assert.equal(auth.refused, false);
});

test('no token, no refresh token', async () => {
  const { auth } = setup();
  await assert.rejects(auth.accessToken(), { code: 'no_token' });
  await assert.rejects(auth.renew(), { code: 'no_token' });
  auth.load(tokenFromStore({ access_token: 'a', expires_at: 0, obtained_at: 1 }));
  await assert.rejects(auth.renew(), { code: 'refused' });
});

test('a stored token round-trips; an older one never replaces a newer one', () => {
  const token = tokenOf(TOKEN, FIXTURE_NOW);
  const stored = tokenToStore(token);
  assert.deepEqual(stored, {
    access_token: TOKEN.access_token,
    refresh_token: TOKEN.refresh_token,
    expires_at: FIXTURE_NOW + 3600_000,
    obtained_at: FIXTURE_NOW,
  });
  assert.deepEqual(tokenFromStore(stored), token);
  assert.deepEqual(tokenFromStore(JSON.stringify(stored)), token);
  assert.equal(tokenFromStore('not json'), null);
  assert.equal(tokenFromStore(undefined), null);
  assert.equal(tokenFromStore({ refresh_token: 'x' }), null);

  const { auth } = setup();
  auth.load(token);
  auth.load({ ...token, accessToken: 'older', obtainedAt: FIXTURE_NOW - 1 });
  assert.equal(auth.token.accessToken, TOKEN.access_token);
  auth.load({ ...token, accessToken: 'newer', obtainedAt: FIXTURE_NOW + 1 });
  assert.equal(auth.token.accessToken, 'newer');
  auth.forget();
  assert.equal(auth.signedIn, false);
});

test('a token answer without expiry lasts an hour; a wrapped one is read too', () => {
  assert.equal(tokenOf({ access_token: 'a' }, 0).expiresAt, 3600_000);
  assert.equal(
    tokenOf({ code: 1, data: { access_token: 'b', expires_in: 60 } }, 0).expiresAt,
    60_000,
  );
  assert.equal(tokenOf({ error: 'invalid_grant' }, 0), null);
  assert.equal(tokenOf(undefined, 0), null);
});

test('the code of a pasted address, or the code itself', () => {
  assert.equal(codeFromInput('http://localhost:1/callback?code=abc123&state=null'), 'abc123');
  assert.equal(codeFromInput('  http://localhost:1/callback?code=x-y_z  '), 'x-y_z');
  assert.equal(codeFromInput('localhost:1/callback?code=abc%2B1'), 'abc+1');
  assert.equal(codeFromInput('abc123'), 'abc123');
  assert.equal(codeFromInput('http://localhost:1/callback?state=null'), null);
  assert.equal(codeFromInput('http://['), null);
  assert.equal(codeFromInput('two words'), null);
  assert.equal(codeFromInput(''), null);
  assert.equal(codeFromInput(undefined), null);
});

test('reasons never carry a token, and boil an HTML page down to its title', () => {
  assert.equal(
    reasonOf(
      new HttpError(502, 'https://h/x?token=secret', '<html><title>502 Bad Gateway</title>'),
    ),
    'HTTP 502 on /x: 502 Bad Gateway',
  );
  assert.equal(
    reasonOf(new HttpError(400, 'https://h/t', { error: 'invalid_grant' })),
    'HTTP 400 on /t: invalid_grant',
  );
  assert.equal(reasonOf(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(
    reasonOf(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })),
    'ENOTFOUND',
  );
  assert.equal(reasonOf(new NavimowError('api', 'Navimow answered 7: x')), 'Navimow answered 7: x');
});
