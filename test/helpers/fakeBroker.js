// -----------------------------------------------------------------------------
// Test helpers: an in-memory MQTT broker speaking the surface of an mqtt.js
// client (connect with CONNACK refusals, subscribe, close, end), and the
// fake timers (nothing fires by itself, the test runs what it wants).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

/** Lets the pending promises and setImmediate callbacks run (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/**
 * A broker. `broker.connect` is the mqtt.connect of the app;
 * `broker.connections` the [url, options] of every attempt;
 * `broker.deliver(topic, message)` sends a message to the subscribers.
 */
export function fakeBroker({
  username = 'gladys-user-123',
  password = 'broker-password-456',
} = {}) {
  const clients = new Set();
  const broker = {
    clients,
    connections: [],
    /** The broker does not answer: the connection fails. */
    unreachable: false,
    /** The broker refuses the subscriptions (QoS 128 in the SUBACK). */
    refuseSubscriptions: false,
    /** Accepted credentials (change them to refuse the current ones). */
    username,
    password,
    connect(url, options) {
      broker.connections.push({ url, options });
      const client = new EventEmitter();
      client.filters = [];
      client.subscribe = (topics, opts, cb) => {
        const list = Array.isArray(topics) ? topics : [topics];
        client.filters.push(...list);
        const done = typeof opts === 'function' ? opts : cb;
        // QoS 128 in the SUBACK: the broker refused the subscription.
        const qos = broker.refuseSubscriptions ? 128 : 0;
        setImmediate(() =>
          done?.(
            null,
            list.map((topic) => ({ topic, qos })),
          ),
        );
      };
      client.end = () => {
        const wasOpen = clients.delete(client);
        client.ended = true;
        // mqtt.js emits "close" once the connection it ended is closed.
        if (wasOpen) {
          setImmediate(() => client.emit('close'));
        }
      };
      setImmediate(() => {
        if (client.ended) {
          return;
        }
        if (broker.unreachable) {
          client.emit(
            'error',
            Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
          );
          client.emit('close');
          return;
        }
        if (options.username !== broker.username || options.password !== broker.password) {
          client.emit(
            'error',
            Object.assign(new Error('Connection refused: Not authorized'), { code: 5 }),
          );
          client.emit('close');
          return;
        }
        clients.add(client);
        client.emit('connect', { returnCode: 0 });
      });
      return client;
    },
    last: () => broker.connections.at(-1),
    deliver(topic, message) {
      const payload = Buffer.from(typeof message === 'string' ? message : JSON.stringify(message));
      for (const client of clients) {
        if (client.filters.includes(topic)) {
          client.emit('message', topic, payload);
        }
      }
    },
    /** The broker drops every client. */
    drop() {
      for (const client of [...clients]) {
        clients.delete(client);
        client.emit('close');
      }
    },
    subscriptions: () => [...clients].flatMap((c) => c.filters),
  };
  return broker;
}

/** The topic of a channel of a mower, as the cloud spells it. */
export const topic = (id, channel) => `/downlink/vehicle/${id}/realtimeDate/${channel}`;

export function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const add = (kind, fn, ms) => {
    const id = nextId++;
    pending.set(id, { id, kind, fn, ms });
    return id;
  };
  return {
    pending,
    setTimeout: (fn, ms) => add('timeout', fn, ms),
    setInterval: (fn, ms) => add('interval', fn, ms),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    timeouts: () => [...pending.values()].filter((t) => t.kind === 'timeout'),
    intervals: () => [...pending.values()].filter((t) => t.kind === 'interval'),
    /** Run (and remove) every pending timeout once. */
    async runTimeouts() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'timeout')) {
        pending.delete(t.id);
        await t.fn();
      }
    },
    async runIntervals() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'interval')) {
        await t.fn();
      }
    },
  };
}
