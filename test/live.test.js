// -----------------------------------------------------------------------------
// The live link (src/navimow/live.js) against the in-memory broker.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NavimowAuth, tokenOf } from '../src/navimow/auth.js';
import { NavimowClient } from '../src/navimow/client.js';
import { LiveLink, brokerOf } from '../src/navimow/live.js';
import { MQTT_RECONNECT } from '../src/constants.js';
import {
  FIXTURE_NOW,
  MQTT_INFO,
  PELOUSE,
  RENEWED,
  TOKEN,
  installNavimow,
  json,
} from './helpers/fakeNavimow.js';
import { createFakeTimers, fakeBroker, settle, topic } from './helpers/fakeBroker.js';

let fake;
afterEach(() => fake?.restore());

function setup() {
  fake = installNavimow();
  const clock = { now: FIXTURE_NOW };
  const auth = new NavimowAuth({ now: () => clock.now });
  auth.load(tokenOf(TOKEN, FIXTURE_NOW));
  const client = new NavimowClient({ auth });
  const broker = fakeBroker();
  const timers = createFakeTimers();
  const logs = [];
  const log = (...args) => logs.push(args.join(' '));
  const live = new LiveLink({
    client,
    auth,
    logger: { info: log, warn: log, error: log, debug: log },
    connect: broker.connect,
    timers,
    now: () => clock.now,
  });
  const messages = [];
  const statuses = [];
  live.on('message', (m) => messages.push(m));
  live.on('status', (s) => statuses.push(s));
  return { auth, live, broker, timers, clock, messages, statuses, logs };
}

test('the broker address and options of the cloud answer (wss, bearer, keepalive 60)', () => {
  const { url, options } = brokerOf(MQTT_INFO, { accessToken: 'tok', clientId: 'web_u_1' });
  assert.equal(url, 'wss://mqtt-fra.navimow.example:443/mqtt');
  assert.deepEqual(options, {
    clientId: 'web_u_1',
    keepalive: 60,
    reconnectPeriod: 0,
    connectTimeout: 30_000,
    clean: true,
    username: 'gladys-user-123',
    password: 'broker-password-456',
    wsOptions: { headers: { Authorization: 'Bearer tok' } },
    rejectUnauthorized: true,
  });
  // A port and a query string are kept, a bare path goes to the host over wss.
  assert.equal(
    brokerOf({ mqttUrl: 'wss://b.example:8084/mqtt?x=1' }, { accessToken: 't' }).url,
    'wss://b.example:8084/mqtt?x=1',
  );
  assert.equal(
    brokerOf({ mqttHost: 'wss://h.example', mqttUrl: 'mqtt' }, { accessToken: 't' }).url,
    'wss://h.example:443/mqtt',
  );
  assert.equal(brokerOf({ mqttUrl: '/mqtt' }, { accessToken: 't' }), null);
  // No WebSocket address: plain MQTT on the host, as both references do.
  const tcp = brokerOf({ mqttHost: 'h.example', userName: 'u' }, { accessToken: 't' });
  assert.equal(tcp.url, 'mqtt://h.example:1883');
  assert.equal(tcp.options.username, undefined, 'credentials only when both are given');
  assert.equal(tcp.options.wsOptions, undefined);
  assert.equal(brokerOf({}, { accessToken: 't' }), null);
});

test('connects with the cloud credentials, subscribes the four channels, relays the messages', async () => {
  const { live, broker, messages, statuses, logs } = setup();
  live.start([PELOUSE]);
  await settle();
  assert.equal(live.connected, true);
  assert.deepEqual(statuses, [true]);
  const { url, options } = broker.last();
  assert.equal(url, 'wss://mqtt-fra.navimow.example:443/mqtt');
  assert.match(options.clientId, /^web_gladys-user-123_[0-9a-f]{10}$/);
  assert.equal(options.wsOptions.headers.Authorization, `Bearer ${TOKEN.access_token}`);
  assert.deepEqual(broker.subscriptions(), [
    topic(PELOUSE, 'state'),
    topic(PELOUSE, 'event'),
    topic(PELOUSE, 'attributes'),
    topic(PELOUSE, 'location'),
  ]);
  broker.deliver(topic(PELOUSE, 'state'), { state: 'isRunning', battery: 79 });
  broker.deliver(topic(PELOUSE, 'state'), 'not json');
  broker.deliver(topic(PELOUSE, 'location'), [{ type: 2, mowingPercentage: 5 }]);
  assert.deepEqual(messages, [
    { deviceId: PELOUSE, channel: 'state', payload: { state: 'isRunning', battery: 79 } },
    { deviceId: PELOUSE, channel: 'location', payload: [{ type: 2, mowingPercentage: 5 }] },
  ]);
  assert.ok(logs.every((line) => !line.includes('broker-password') && !line.includes(':443/mqtt')));
});

test('a closed connection fetches new credentials and reconnects after a delay', async () => {
  const { live, broker, timers, statuses } = setup();
  live.start([PELOUSE]);
  await settle();
  broker.drop();
  await settle();
  assert.equal(live.connected, false);
  assert.deepEqual(statuses, [true, false]);
  assert.equal(timers.timeouts()[0].ms, MQTT_RECONNECT[0]);
  await timers.runTimeouts();
  await settle();
  assert.equal(live.connected, true);
  assert.equal(fake.to('userInfo/get/v2').length, 2, 'credentials fetched again');
  assert.equal(broker.connections.length, 2);
  assert.equal(
    broker.connections[0].options.clientId,
    broker.connections[1].options.clientId,
    'one client id for the process',
  );
});

test('refused credentials: growing delays, credentials fetched again', async () => {
  const { live, broker, timers, logs } = setup();
  broker.password = 'rotated';
  live.start([PELOUSE]);
  await settle();
  assert.equal(live.connected, false);
  const delays = [];
  for (let i = 0; i < 3; i += 1) {
    delays.push(timers.timeouts()[0].ms);
    await timers.runTimeouts();
    await settle();
  }
  assert.deepEqual(delays, MQTT_RECONNECT.slice(0, 3));
  assert.equal(fake.to('userInfo/get/v2').length, 4);
  assert.ok(
    logs.some((line) => line.includes('the broker refused the connection (not authorized)')),
  );
  // The cloud hands out credentials the broker takes again.
  broker.password = 'broker-password-456';
  await timers.runTimeouts();
  await settle();
  assert.equal(live.connected, true);
});

test('an unreachable broker does not hammer the credential endpoint', async () => {
  const { live, broker, timers, clock } = setup();
  broker.unreachable = true;
  live.start([PELOUSE]);
  await settle();
  for (let i = 0; i < 4; i += 1) {
    await timers.runTimeouts();
    await settle();
  }
  assert.equal(broker.connections.length, 5);
  assert.equal(fake.to('userInfo/get/v2').length, 1, 'never connected: no new credentials yet');
  clock.now += 11 * 60_000;
  // The next close past 10 minutes asks for them again.
  await timers.runTimeouts();
  await settle();
  broker.unreachable = false;
  await timers.runTimeouts();
  await settle();
  assert.equal(fake.to('userInfo/get/v2').length, 2);
  assert.equal(live.connected, true);
});

test('the credential endpoint failing: the previous credentials are tried', async () => {
  const { live, broker, timers, logs } = setup();
  live.start([PELOUSE]);
  await settle();
  fake.state.fail.set('userInfo', json({ code: 5001, desc: 'url Circuit Breaker' }));
  broker.drop();
  await settle();
  await timers.runTimeouts();
  await settle();
  assert.equal(live.connected, true);
  assert.ok(logs.some((line) => line.includes('Circuit Breaker')));
});

test('no credentials at all: retried later', async () => {
  const { live, timers } = setup();
  fake.state.fail.set('userInfo', json({ code: 5001, desc: 'url Circuit Breaker' }));
  live.start([PELOUSE]);
  await settle();
  assert.equal(live.connected, false);
  assert.equal(timers.timeouts().length, 1);
  fake.state.fail.clear();
  await timers.runTimeouts();
  await settle();
  assert.equal(live.connected, true);
});

test('connected only once the subscriptions are acknowledged; refused ones reconnect', async () => {
  const { live, broker, timers, statuses, logs } = setup();
  broker.refuseSubscriptions = true;
  live.start([PELOUSE]);
  await settle();
  assert.equal(live.connected, false);
  assert.deepEqual(statuses, []);
  assert.ok(logs.some((line) => line.includes('subscription refused (4 topic(s))')));
  assert.equal(broker.clients.size, 0, 'the connection was ended');
  assert.equal(timers.timeouts().length, 1, 'a new connection is scheduled');
  broker.refuseSubscriptions = false;
  await timers.runTimeouts();
  await settle();
  assert.equal(live.connected, true);
});

test('a refused sign-in stops the link: no retry loop', async () => {
  const { live, auth, timers } = setup();
  auth.refused = true;
  live.start([PELOUSE]);
  await settle();
  assert.equal(live.connected, false);
  assert.equal(timers.timeouts().length, 0);
});

test('a renewed token reconnects with it; stop closes everything', async () => {
  const { live, broker, auth, timers } = setup();
  live.start([PELOUSE]);
  await settle();
  await auth.renew();
  live.renewed();
  await settle();
  assert.equal(broker.connections.length, 2);
  assert.equal(
    broker.last().options.wsOptions.headers.Authorization,
    `Bearer ${RENEWED.access_token}`,
  );
  assert.equal(broker.clients.size, 1, 'the old client was ended');
  live.stop();
  assert.equal(live.connected, false);
  assert.equal(broker.clients.size, 0);
  assert.equal(timers.timeouts().length, 0);
  live.renewed();
  await settle();
  assert.equal(broker.connections.length, 2, 'stopped: a renewal does not reconnect');
});

test('no mower, no connection; messages for other mowers are ignored', async () => {
  const { live, broker, messages } = setup();
  live.start([]);
  await settle();
  assert.equal(broker.connections.length, 0);
  live.start([PELOUSE]);
  await settle();
  broker.clients.values().next().value.emit('message', topic('OTHER', 'state'), Buffer.from('{}'));
  broker.clients.values().next().value.emit('message', 'navimow/x/command', Buffer.from('{}'));
  assert.equal(messages.length, 0);
});
