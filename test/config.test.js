// -----------------------------------------------------------------------------
// The configuration, normalized (src/config.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig } from '../src/config.js';
import { TOKEN_KEY } from '../src/constants.js';

test('defaults', () => {
  assert.deepEqual(normalizeConfig(), { pollMinutes: 5, language: 'fr', token: null });
  assert.deepEqual(DEFAULTS, { poll_minutes: 5, language: 'fr' });
});

test('bounds and values', () => {
  assert.equal(normalizeConfig({ poll_minutes: 0 }).pollMinutes, 1);
  assert.equal(normalizeConfig({ poll_minutes: 600 }).pollMinutes, 60);
  assert.equal(normalizeConfig({ poll_minutes: '12.4' }).pollMinutes, 12);
  assert.equal(normalizeConfig({ poll_minutes: '' }).pollMinutes, 5);
  assert.equal(normalizeConfig({ poll_minutes: null }).pollMinutes, 5);
  assert.equal(normalizeConfig({ poll_minutes: 'abc' }).pollMinutes, 5);
  assert.equal(normalizeConfig({ language: 'EN' }).language, 'en');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
});

test('the stored token, as Gladys gives it back', () => {
  const stored = { access_token: 'a', refresh_token: 'r', expires_at: 10, obtained_at: 5 };
  assert.deepEqual(normalizeConfig({ [TOKEN_KEY]: stored }).token, {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 10,
    obtainedAt: 5,
  });
  assert.equal(normalizeConfig({ [TOKEN_KEY]: JSON.stringify(stored) }).token.accessToken, 'a');
  assert.equal(normalizeConfig({ [TOKEN_KEY]: 'garbage' }).token, null);
});
