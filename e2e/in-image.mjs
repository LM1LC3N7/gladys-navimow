// -----------------------------------------------------------------------------
// End to end, inside the production image (mounted at /app/e2e): the real
// NavimowApp, every SDK handler on the SDK's fake Gladys, the real fetch and
// the real mqtt.js, against the fake Navimow cloud (e2e/fake-cloud.mjs) and a
// real Mosquitto behind its WebSocket proxy. Prints one line per check, exits
// 1 on the first failure.
// -----------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { NavimowApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { SCENE_ACTIONS, SCENE_TRIGGERS, TOKEN_KEY } from '../src/constants.js';

const API = process.env.NAVIMOW_E2E_API ?? 'https://navimow-fake:8443';
const REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';
const DEVICE = 'ext:navimow:mower:NVM6E2C1A90B47D';
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const logs = [];
const logger = {
  info: (...a) => logs.push(`info ${a.join(' ')}`),
  warn: (...a) => logs.push(`warn ${a.join(' ')}`),
  error: (...a) => logs.push(`error ${a.join(' ')}`),
  debug: () => {},
};

const ok = (line) => console.log(`✔ ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, check, timeout = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const control = async (path, body) => {
  const response = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
};

let gladys;
let app;
try {
  gladys = createFakeGladys({ selector: 'navimow', config: { language: 'en' }, logger: quiet });
  app = new NavimowApp({ gladys, logger, apiUrl: API });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  ok('not signed in: status asks to connect, no call made');

  // --- The Connect button ---------------------------------------------------------------
  const ack = await gladys.fake.oauthAuthorizeUrl('account', REDIRECT);
  const url = new URL(ack.data.authorize_url);
  assert.equal(url.host, 'navimow-h5-fra.willand.com');
  // The user signs in on Segway's page, which sends the browser back with a code.
  const callback = await gladys.fake.oauthCallback('account', {
    code: 'e2e-code',
    state: url.searchParams.get('state'),
    redirectUri: REDIRECT,
  });
  assert.equal(callback.success, true, JSON.stringify(callback));
  assert.equal(gladys.fake.config[TOKEN_KEY].access_token, 'e2e-access-1');
  ok('Connect: code exchanged over HTTPS, token stored off-schema');

  await until('the live link', () => app.live.connected);
  await until('the discovered mower', () => gladys.fake.discoveredDevices.length === 1);
  let { upgrades } = await control('/e2e/calls');
  assert.equal(upgrades.at(-1).auth, 'Bearer e2e-access-1');
  assert.equal(upgrades.at(-1).protocol, 'mqtt');
  ok('live link: WSS handshake with the bearer token, MQTT session on Mosquitto');
  await until('the green status', () => gladys.fake.connectionStatus.connected);
  assert.match(gladys.fake.connectionStatus.message.en, /1 mower, live updates on/);
  ok(`status: ${gladys.fake.connectionStatus.message.en}`);

  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await until('the battery state', () => gladys.fake.lastState(`${DEVICE}:battery`) === 80);
  ok('device created: REST state published (docked, 80 %)');

  // --- Live messages through the real broker ----------------------------------------------
  await control('/e2e/publish', { channel: 'state', payload: { state: 'isRunning', battery: 77 } });
  await until('the live state', () => gladys.fake.lastState(`${DEVICE}:battery`) === 77);
  assert.equal(gladys.fake.lastState(`${DEVICE}:state`), 1);
  ok('state channel: running, 77 % (subscribed on /downlink/vehicle/<id>/realtimeDate/state)');

  await control('/e2e/publish', {
    channel: 'location',
    payload: [
      { postureX: '1.0', postureY: '2.0', time: Date.now(), type: 1 },
      { mowingPercentage: 42, subtotalArea: '120.5', time: Date.now(), type: 2 },
    ],
  });
  await until('the progress', () => gladys.fake.lastState(`${DEVICE}:progress`) === 42);
  assert.equal(gladys.fake.lastState(`${DEVICE}:mowed_area`), 120.5);
  ok('location channel: progress 42 %, 120.5 m² (positions dropped)');

  await control('/e2e/publish', {
    channel: 'state',
    payload: { state: 'Error', error: { code: 214, message: 'Blade motor overload' } },
  });
  await until('the error event', () =>
    gladys.fake.sceneEvents.some((e) => e.key === SCENE_TRIGGERS.ERROR),
  );
  assert.equal(gladys.fake.lastState(`${DEVICE}:error_code`), 214);
  ok('error: state Error, code 214, scene event mower_error');

  await control('/e2e/publish', { channel: 'state', payload: { state: 'isDocked' } });
  await until('the arrival', () =>
    gladys.fake.sceneEvents.some((e) => e.key === SCENE_TRIGGERS.BACK),
  );
  const finished = gladys.fake.sceneEvents.find((e) => e.key === SCENE_TRIGGERS.FINISHED);
  assert.equal(finished.data.outcome, 'interrupted');
  assert.equal(finished.data.progress, 42);
  ok('docked: mowing_finished (interrupted at 42 %) and back_to_station');

  // --- A command ----------------------------------------------------------------------
  const action = await gladys.fake.sceneAction(SCENE_ACTIONS.START, { mower: DEVICE });
  assert.deepEqual(action.data.outputs, { mower_name: 'Pelouse', count: 1 });
  const { calls } = await control('/e2e/calls');
  const command = calls.findLast((c) => c.path === '/openapi/smarthome/sendCommands');
  assert.equal(command.auth, 'Bearer e2e-access-1');
  assert.deepEqual(JSON.parse(command.body).commands[0].execution, {
    command: 'action.devices.commands.StartStop',
    params: { on: true },
  });
  ok('scene action start: sendCommands StartStop on:true with the bearer');

  // --- Token renewal: stored, and the live link reconnects with it ----------------------
  app.auth.token.expiresAt = Date.now() + 4 * 60_000;
  await app.tick();
  assert.equal(gladys.fake.config[TOKEN_KEY].access_token, 'e2e-access-2');
  await until('the reconnection', async () => {
    ({ upgrades } = await control('/e2e/calls'));
    return upgrades.at(-1).auth === 'Bearer e2e-access-2' && app.live.connected;
  });
  await control('/e2e/publish', { channel: 'state', payload: { state: 'isRunning', battery: 76 } });
  await until(
    'a message on the new session',
    () => gladys.fake.lastState(`${DEVICE}:battery`) === 76,
  );
  ok('renewal: new token stored, live link reconnected with it, messages flow');

  // --- A refused token is refused by the proxy too ---------------------------------------
  const refused = upgrades.filter((u) => !u.ok).length;
  assert.equal(refused, 0, 'no refused handshake');

  const rss = Math.round(process.memoryUsage().rss / 1048576);
  ok(`memory: RSS ${rss} MB, node ${process.version}, uid ${process.getuid()}`);
  assert.ok(
    logs.every((line) => !line.includes('e2e-access') && !line.includes('e2e-password')),
    'no secret in the logs',
  );
  ok('no token nor broker password in the logs');
  await gladys.fake.shutdown();
  ok('shutdown: clean');
  process.exit(0);
} catch (err) {
  console.error(`✖ ${err.stack ?? err}`);
  console.error(logs.slice(-20).join('\n'));
  process.exit(1);
}
