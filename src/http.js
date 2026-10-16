// -----------------------------------------------------------------------------
// The only place that talks HTTP: `fetch` with a timeout and an identifiable
// User-Agent. The tests replace it with `setFetch()`. The MQTT link lives in
// src/navimow/live.js, behind its own connect function.
//
// An error never carries a header (the token travels in them) nor a query
// string: the path and the status only.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} on ${new URL(url).pathname}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

const parse = (text) => {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * One request. `body` is form-encoded with `form: true`, else JSON-encoded.
 * Resolves { status, data }; throws an HttpError on a non-2xx status (with
 * the parsed body), and the fetch error (timeout, DNS...) as it is.
 */
export async function request(
  url,
  { method = 'GET', headers = {}, body, form = false, timeout = HTTP_TIMEOUT } = {},
) {
  const init = {
    method,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1, timeout)),
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
    init.body = form ? new URLSearchParams(body).toString() : JSON.stringify(body);
  }
  const response = await fetchImpl(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, url, parse(text.slice(0, 2000)));
  }
  return { status: response.status, data: parse(text) };
}
