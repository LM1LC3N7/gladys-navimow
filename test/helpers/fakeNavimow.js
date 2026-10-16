// -----------------------------------------------------------------------------
// A fake Navimow cloud for the tests: the token endpoint and the open API
// behind `fetch`, with the real error answers (invalid_grant, TOKEN_EMPTY,
// CODE_OAUTH_INFO_ILLEGAL), every call recorded, and a loud failure on an
// unexpected one. No test touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/** 2026-08-11T12:00:00Z: just after the recorded location readings (the last one at 11:29). */
export const FIXTURE_NOW = Date.parse('2026-08-11T12:00:00Z');

/** The two mowers of devices.json. */
export const PELOUSE = 'NVM6E2C1A90B47D';
export const POTAGER = 'NVM-X3/potager';
export const POTAGER_SAFE = 'NVM-X3_potager';

export const TOKEN = fixture('token.json');
export const RENEWED = fixture('token-refreshed.json');
export const MQTT_INFO = fixture('mqtt-info.json').data;

export const json = (body, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * The fake cloud. `state` (all optional, editable during a test):
 * - codes: authorization codes accepted once (default ['good-code'])
 * - refreshTokens: refresh token -> token answer (default: TOKEN's -> RENEWED)
 * - valid: the access tokens the API accepts (default: both fixtures')
 * - devices / statuses: the answers of authList / getVehicleStatus
 * - command: the answer of sendCommands
 * - mqttInfo: the answer of mqtt/userInfo/get/v2
 * - fail: path part -> Response or Error, answered instead (once if `failOnce`)
 */
export function installNavimow(overrides = {}) {
  const state = {
    codes: new Set(['good-code']),
    refreshTokens: new Map([
      [TOKEN.refresh_token, RENEWED],
      [RENEWED.refresh_token, RENEWED],
    ]),
    valid: new Set([TOKEN.access_token, RENEWED.access_token]),
    devices: fixture('devices.json'),
    statuses: fixture('statuses.json'),
    command: fixture('commands-ok.json'),
    mqttInfo: fixture('mqtt-info.json'),
    fail: new Map(),
    ...overrides,
  };
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const parsed = new URL(url);
    const path = parsed.pathname;
    let body = init.body;
    if (typeof body === 'string') {
      body = init.headers?.['Content-Type']?.includes('form')
        ? Object.fromEntries(new URLSearchParams(body))
        : JSON.parse(body);
    }
    const call = { url, host: parsed.host, path, method, headers: init.headers ?? {}, body };
    calls.push(call);
    for (const [part, answer] of state.fail) {
      if (path.includes(part)) {
        if (state.failOnce) {
          state.fail.delete(part);
        }
        if (answer instanceof Error) {
          throw answer;
        }
        return answer;
      }
    }
    if (method === 'POST' && path === '/openapi/oauth/getAccessToken') {
      if (body.client_id !== 'homeassistant' || !body.client_secret) {
        return json({ error: 'invalid_client' }, 401);
      }
      if (body.grant_type === 'authorization_code' && state.codes.has(body.code)) {
        state.codes.delete(body.code);
        return json(state.token ?? TOKEN);
      }
      if (body.grant_type === 'refresh_token' && state.refreshTokens.has(body.refresh_token)) {
        return json(state.refreshTokens.get(body.refresh_token));
      }
      return json(fixture('invalid-grant.json'), 400);
    }
    const auth = call.headers.Authorization;
    if (!auth) {
      return json(fixture('token-empty.json'));
    }
    if (!state.valid.has(auth.replace(/^Bearer /, ''))) {
      return json(fixture('oauth-illegal.json'));
    }
    if (method === 'GET' && path === '/openapi/smarthome/authList') {
      return json(state.devices);
    }
    if (method === 'POST' && path === '/openapi/smarthome/getVehicleStatus') {
      const wanted = new Set((body?.devices ?? []).map((d) => d.id));
      const answer = structuredClone(state.statuses);
      answer.data.payload.devices = answer.data.payload.devices.filter((d) => wanted.has(d.id));
      return json(answer);
    }
    if (method === 'POST' && path === '/openapi/smarthome/sendCommands') {
      return json(state.command);
    }
    if (method === 'GET' && path === '/openapi/mqtt/userInfo/get/v2') {
      return json(state.mqttInfo);
    }
    throw new Error(`Unexpected network call in a test: ${method} ${url}`);
  });
  return {
    state,
    calls,
    /** The calls to one path (by its end). */
    to: (end) => calls.filter((c) => c.path.endsWith(end)),
    restore: () => setFetch(previous),
  };
}

/** statuses.json with `edit(entry)` applied to the entry of `id`. */
export function statusesWith(id, edit) {
  const answer = fixture('statuses.json');
  for (const entry of answer.data.payload.devices) {
    if (entry.id === id) {
      edit(entry);
    }
  }
  return answer;
}
