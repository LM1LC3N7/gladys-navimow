// -----------------------------------------------------------------------------
// The live link: MQTT over a secure WebSocket to the Navimow broker, on
// mqtt.js. Portions adapted from ioBroker.navimow 1.1.2 (main.js: the broker
// address, the connection options, the topics, the credential refresh on a
// closed connection), Copyright (c) 2026 TA2k, MIT licence: see
// THIRD_PARTY_NOTICES.md.
//
// GET /openapi/mqtt/userInfo/get/v2 gives the broker (`mqttHost`, `mqttUrl`)
// and its credentials (`userName`, `pwdInfo`), which are bound to the OAuth
// token: after a renewal, or when an established connection closes, they are
// fetched again. The WebSocket handshake also carries the bearer token. The
// reconnection is ours (mqtt.js's is off): growing delays, and a connection
// that never came up fetches the credentials at most every 10 minutes (that
// endpoint has a circuit breaker; a cached answer is reused when it trips).
// Keepalive 60 s: ioBroker.navimow measured that something on the way reaps
// a connection idle for about ten minutes, without closing it.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import mqtt from 'mqtt';
import {
  CHANNELS,
  MQTT_CONNECT_TIMEOUT,
  MQTT_CREDENTIALS_MIN_AGE,
  MQTT_KEEPALIVE,
  MQTT_RECONNECT,
} from '../constants.js';
import { reasonOf } from './auth.js';
import { parseTopic, topicsOf } from './model.js';

const defaultTimers = { setTimeout, clearTimeout };

/** The hostname of `mqttHost`, which may come with a scheme (wss://host). */
function hostOf(mqttHost) {
  const value = String(mqttHost ?? '').trim();
  if (!value) {
    return null;
  }
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

/**
 * The broker address and the mqtt.js options for an answer of
 * userInfo/get/v2. WebSocket (wss) when `mqttUrl` is given, the way the
 * cloud answers; plain MQTT on 1883 otherwise, as both references do.
 */
export function brokerOf(info, { accessToken, clientId }) {
  const host = hostOf(info?.mqttHost);
  const options = {
    clientId,
    keepalive: MQTT_KEEPALIVE,
    reconnectPeriod: 0,
    connectTimeout: MQTT_CONNECT_TIMEOUT,
    clean: true,
  };
  if (info?.userName && info?.pwdInfo) {
    options.username = String(info.userName);
    options.password = String(info.pwdInfo);
  }
  const raw = typeof info?.mqttUrl === 'string' ? info.mqttUrl.trim() : '';
  if (raw) {
    options.wsOptions = { headers: { Authorization: `Bearer ${accessToken}` } };
    let url;
    try {
      const parsed = new URL(raw);
      const scheme = parsed.protocol === 'ws:' ? 'ws' : 'wss';
      const port = parsed.port || (scheme === 'wss' ? 443 : 80);
      url = `${scheme}://${parsed.hostname || host}:${port}${parsed.pathname || '/'}${parsed.search}`;
    } catch {
      // A bare path: on the host, over wss.
      if (!host) {
        return null;
      }
      url = `wss://${host}:443${raw.startsWith('/') ? raw : `/${raw}`}`;
    }
    if (url.startsWith('wss:')) {
      options.rejectUnauthorized = true;
    }
    return { url, options };
  }
  return host ? { url: `mqtt://${host}:1883`, options } : null;
}

/** MQTT 3.1.1 CONNACK refusals. */
const REFUSALS = {
  1: 'unacceptable protocol version',
  2: 'client id rejected',
  3: 'server unavailable',
  4: 'bad user name or password',
  5: 'not authorized',
};

/** A readable reason for an MQTT error (a CONNACK refusal carries a numeric code). */
export const mqttReason = (err) =>
  typeof err?.code === 'number' && REFUSALS[err.code]
    ? `the broker refused the connection (${REFUSALS[err.code]})`
    : reasonOf(err);

/** The host of a broker address, for the logs (never its path: it may carry a key). */
const shown = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '?';
  }
};

export class LiveLink extends EventEmitter {
  constructor({
    client,
    auth,
    logger,
    connect = (url, options) => mqtt.connect(url, options),
    timers = defaultTimers,
    now = Date.now,
  }) {
    super();
    this.client = client;
    this.auth = auth;
    this.logger = logger;
    this.connectFn = connect;
    this.timers = timers;
    this.now = now;
    // One client id for the life of the process: a reconnection replaces
    // the previous session at the broker instead of piling up.
    this.suffix = randomBytes(5).toString('hex');
    this.deviceIds = [];
    this.mqtt = undefined;
    this.info = undefined;
    this.infoAt = -Infinity;
    this.needInfo = true;
    this.failures = 0;
    this.retryTimer = undefined;
    this.running = false;
    this.connected = false;
    this.generation = 0;
  }

  /** Connect (again) for these mowers. */
  start(deviceIds) {
    this.deviceIds = [...deviceIds];
    this.running = true;
    this.failures = 0;
    this.reconnect({ refreshInfo: false });
  }

  stop() {
    this.running = false;
    this.generation += 1;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.close();
    this.setConnected(false);
  }

  /** The token was renewed: new credentials, new connection (ioBroker.navimow does the same). */
  renewed() {
    if (this.running) {
      this.reconnect({ refreshInfo: true });
    }
  }

  close() {
    const old = this.mqtt;
    this.mqtt = undefined;
    if (old) {
      old.removeAllListeners('close');
      old.on('error', () => {});
      old.end(true);
    }
  }

  setConnected(connected) {
    if (this.connected !== connected) {
      this.connected = connected;
      this.emit('status', connected);
    }
  }

  reconnect({ refreshInfo }) {
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (refreshInfo) {
      this.needInfo = true;
    }
    this.close();
    this.setConnected(false);
    const generation = ++this.generation;
    this.connectNow(generation).catch((err) => {
      this.logger.warn(`Live link: ${reasonOf(err)}`);
      // Without a usable sign-in nothing can work: the app restarts the
      // link once the user has signed in again.
      if (err?.code !== 'refused' && err?.code !== 'no_token') {
        this.schedule(generation);
      }
    });
  }

  schedule(generation) {
    if (!this.running || generation !== this.generation) {
      return;
    }
    const delay = MQTT_RECONNECT[Math.min(this.failures, MQTT_RECONNECT.length - 1)];
    this.failures += 1;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      if (generation === this.generation) {
        this.reconnect({ refreshInfo: false });
      }
    }, delay);
  }

  async fetchInfo() {
    try {
      this.info = await this.client.mqttInfo();
      this.infoAt = this.now();
      this.needInfo = false;
    } catch (err) {
      this.infoAt = this.now();
      if (!this.info) {
        throw err;
      }
      // NavimowHA: the endpoint trips a circuit breaker; the last answer may still work.
      this.logger.warn(`Live link credentials: ${reasonOf(err)}; trying the previous ones`);
    }
  }

  async connectNow(generation) {
    if (this.deviceIds.length === 0) {
      return;
    }
    if (!this.info || this.needInfo || this.now() - this.infoAt > 6 * 60 * 60_000) {
      await this.fetchInfo();
    }
    const accessToken = await this.auth.accessToken();
    if (!this.running || generation !== this.generation) {
      return;
    }
    const broker = brokerOf(this.info, {
      accessToken,
      clientId: `web_${this.info?.userName || 'gladys'}_${this.suffix}`,
    });
    if (!broker) {
      throw new Error('the cloud gave no MQTT broker');
    }
    this.logger.debug(`Live link: connecting to ${shown(broker.url)}`);
    const client = this.connectFn(broker.url, broker.options);
    this.mqtt = client;
    let wasConnected = false;
    let refused = false;

    client.on('connect', () => {
      if (this.mqtt !== client) {
        return;
      }
      wasConnected = true;
      this.failures = 0;
      const topics = this.deviceIds.flatMap((id) => topicsOf(id, CHANNELS));
      // "Connected" once the broker acknowledged the subscriptions: a message
      // published before the SUBACK is not delivered (QoS 0, nothing retained).
      client.subscribe(topics, { qos: 0 }, (err, granted) => {
        if (this.mqtt !== client) {
          return;
        }
        const rejected = (granted ?? []).filter((g) => g?.qos === 128).length;
        if (err || rejected > 0) {
          this.logger.warn(
            `Live link: subscription refused (${err ? reasonOf(err) : `${rejected} topic(s)`})`,
          );
          // A new connection may fare better; the close handler schedules it.
          client.end(true);
          return;
        }
        this.logger.info(`Live link connected (${this.deviceIds.length} mower(s))`);
        this.setConnected(true);
      });
    });

    client.on('message', (topic, payload) => {
      if (this.mqtt !== client) {
        return;
      }
      const parsed = parseTopic(topic);
      if (!parsed || !this.deviceIds.includes(parsed.deviceId)) {
        return;
      }
      let message;
      try {
        message = JSON.parse(Buffer.from(payload).toString('utf8'));
      } catch {
        this.logger.debug(`Live link: ${parsed.channel} message that is not JSON, ignored`);
        return;
      }
      this.emit('message', { ...parsed, payload: message });
    });

    client.on('error', (err) => {
      if (this.mqtt !== client) {
        return;
      }
      // CONNACK 4/5: the broker refused the credentials (bound to the token).
      if (err?.code === 4 || err?.code === 5) {
        refused = true;
      }
      const line = `Live link error: ${mqttReason(err)}`;
      if (this.failures === 2) {
        this.logger.error(line);
      } else if (this.failures < 2) {
        this.logger.warn(line);
      } else {
        this.logger.debug(line);
      }
    });

    client.on('close', () => {
      if (this.mqtt !== client) {
        return;
      }
      this.mqtt = undefined;
      client.removeAllListeners();
      client.on('error', () => {});
      client.end(true);
      if (wasConnected) {
        this.logger.info('Live link closed');
      }
      this.setConnected(false);
      if (wasConnected || refused || this.now() - this.infoAt > MQTT_CREDENTIALS_MIN_AGE) {
        this.needInfo = true;
      }
      this.schedule(generation);
    });
  }
}
