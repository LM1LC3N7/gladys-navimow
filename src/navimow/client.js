// -----------------------------------------------------------------------------
// The REST client of the Navimow open API: the bearer token, a fresh
// `requestId` per call (as navimow-sdk sends it), the `code` check, and one
// renewal of the token when the API says it is no longer valid.
//
// The API answers HTTP 200 with { code, desc, data }: code 1 is a success,
// 4003 TOKEN_EMPTY and 4005 CODE_OAUTH_INFO_ILLEGAL are the answers to a
// missing or refused token (probed 2026-10-16).
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { ALREADY_IN_STATE, API_CODES, API_URL, COMMANDS, PATHS } from '../constants.js';
import { HttpError, request } from '../http.js';
import { NavimowError, reasonOf } from './auth.js';
import { devicesOf, statusesOf } from './model.js';

const TOKEN_CODES = new Set([API_CODES.TOKEN_EMPTY, API_CODES.TOKEN_ILLEGAL]);

export class NavimowClient {
  constructor({ auth, apiUrl = API_URL }) {
    this.auth = auth;
    this.apiUrl = apiUrl;
  }

  /** One call; `data` of the answer. A refused token is renewed once and the call replayed. */
  async call(method, path, body, { retried = false } = {}) {
    const token = await this.auth.accessToken();
    let response;
    try {
      response = await request(`${this.apiUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, requestId: randomUUID() },
        body,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 401 && !retried) {
        await this.auth.renew();
        return this.call(method, path, body, { retried: true });
      }
      throw new NavimowError('unreachable', reasonOf(err), { status: err?.status });
    }
    const answer = response.data;
    if (!answer || typeof answer !== 'object') {
      throw new NavimowError('api', `Unexpected answer on ${path}`);
    }
    if (answer.code === API_CODES.OK) {
      return answer.data ?? {};
    }
    if (TOKEN_CODES.has(answer.code)) {
      if (!retried) {
        await this.auth.renew();
        return this.call(method, path, body, { retried: true });
      }
      throw new NavimowError('token', `Navimow refused the token (${answer.desc ?? answer.code})`, {
        apiCode: answer.code,
      });
    }
    throw new NavimowError('api', `Navimow answered ${answer.code}: ${answer.desc ?? '?'}`, {
      apiCode: answer.code,
    });
  }

  /** The mowers of the account: [{ id, name, model, firmware, serial, online }]. */
  async devices() {
    return devicesOf(await this.call('GET', PATHS.DEVICES));
  }

  /** The status of some mowers, in one call: Map id -> reading (model.js readingOf). */
  async statuses(ids) {
    if (ids.length === 0) {
      return new Map();
    }
    return statusesOf(
      await this.call('POST', PATHS.STATUS, { devices: ids.map((id) => ({ id })) }),
    );
  }

  /** The MQTT broker and its credentials: { mqttHost, mqttUrl, userName, pwdInfo }. */
  async mqttInfo() {
    return this.call('GET', PATHS.MQTT_INFO);
  }

  /** start | pause | resume | dock. A command already in effect counts as done. */
  async command(id, name) {
    const execution = COMMANDS[name];
    if (!execution) {
      throw new Error(`Unknown command ${name}`);
    }
    const data = await this.call('POST', PATHS.COMMANDS, {
      commands: [{ devices: [{ id }], execution }],
    });
    for (const result of data?.payload?.commands ?? []) {
      if (result?.status === 'ERROR' && result.errorCode !== ALREADY_IN_STATE) {
        throw new NavimowError(
          'command',
          `Navimow refused ${name}: ${result.errorCode ?? 'error'}`,
        );
      }
    }
    return data;
  }
}
