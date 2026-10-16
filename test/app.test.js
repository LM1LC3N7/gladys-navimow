// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys (every handler of
// src/handlers.js), a fake Navimow cloud and an in-memory MQTT broker.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { NavimowApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import {
  ACTIONS,
  COMMAND_SETTLE,
  DOCK_STATE,
  FALLBACK_POLL,
  OAUTH,
  RUN_MODE,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  TOKEN_KEY,
  TOKEN_MARGIN,
  TOKEN_RETRY,
  WIDGETS,
} from '../src/constants.js';
import { tokenOf, tokenToStore } from '../src/navimow/auth.js';
import {
  FIXTURE_NOW,
  PELOUSE,
  POTAGER,
  POTAGER_SAFE,
  RENEWED,
  TOKEN,
  fixture,
  installNavimow,
  json,
  statusesWith,
} from './helpers/fakeNavimow.js';
import { createFakeTimers, fakeBroker, settle, topic } from './helpers/fakeBroker.js';

let fake;
afterEach(() => fake?.restore());

const MINUTE = 60_000;
const REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';
const STORED = tokenToStore(tokenOf(TOKEN, FIXTURE_NOW));
const SIGNED_IN = { [TOKEN_KEY]: STORED, poll_minutes: 5, language: 'en' };
const DEVICE = `ext:navimow:mower:${PELOUSE}`;
const DEVICE2 = `ext:navimow:mower:${POTAGER_SAFE}`;
const STATE = fixture('mqtt-state.json');
const LOCATION = fixture('location.json');

async function setup({ config = SIGNED_IN, create = true, overrides } = {}) {
  fake = installNavimow(overrides);
  const gladys = createFakeGladys({ selector: 'navimow', config });
  const timers = createFakeTimers();
  const broker = fakeBroker();
  const clock = { now: FIXTURE_NOW };
  const logs = [];
  const log = (...args) => logs.push(args.map(String).join(' '));
  const logger = { info: log, warn: log, error: log, debug: log };
  const app = new NavimowApp({
    gladys,
    logger,
    now: () => clock.now,
    timers,
    mqttConnect: broker.connect,
  });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  await settle();
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
  }
  await settle();
  return { app, gladys, timers, broker, clock, logs };
}

const state = (gladys, device, key) => gladys.fake.lastState(`${device}:${key}`);
const events = (gladys, key) => gladys.fake.sceneEvents.filter((e) => e.key === key);
const tick = async (ctx) => {
  await ctx.timers.runIntervals();
  await settle();
};

// --- Sign-in ---------------------------------------------------------------------------

test('not signed in: a status that says what to do, and no call to Navimow', async () => {
  const { gladys, broker } = await setup({ config: {} });
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: {
      en: 'Not connected: click "Connect" next to "Navimow account" and sign in with the account of the Navimow app.',
      fr: "Non connecté : cliquez sur « Connecter » à côté de « Compte Navimow » et connectez-vous avec le compte de l'application Navimow.",
    },
  });
  assert.equal(fake.calls.length, 0);
  assert.equal(broker.connections.length, 0);
  await gladys.fake.scanRequest();
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  const test = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(test.data.message.en, /^Not connected/);
  const scene = await gladys.fake.sceneAction(SCENE_ACTIONS.START, {});
  assert.equal(scene.success, false);
});

test('the Connect button: sign-in page, callback, token stored, mowers found', async () => {
  const { gladys, broker } = await setup({ config: {} });
  const ack = await gladys.fake.oauthAuthorizeUrl('account', REDIRECT);
  assert.equal(ack.success, true);
  const url = new URL(ack.data.authorize_url);
  assert.equal(`${url.origin}${url.pathname}`, OAUTH.AUTHORIZE_URL);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  const stateParam = url.searchParams.get('state');

  // A forged state, then the real one.
  const forged = await gladys.fake.oauthCallback('account', {
    code: 'good-code',
    state: 'forged',
    redirectUri: REDIRECT,
  });
  assert.equal(forged.success, false);
  assert.match(forged.error, /not started from this Gladys/);
  const done = await gladys.fake.oauthCallback('account', {
    code: 'good-code',
    state: stateParam,
    redirectUri: REDIRECT,
  });
  assert.equal(done.success, true);
  const [exchange] = fake.to('getAccessToken');
  assert.equal(exchange.body.redirect_uri, REDIRECT);
  assert.equal(exchange.body.code, 'good-code');
  // The token is kept off-schema in Gladys.
  assert.deepEqual(gladys.fake.config[TOKEN_KEY], STORED);
  await settle();
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(broker.clients.size, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Connected to Navimow: 2 mowers, live updates on/,
  );
  // A state serves once.
  const replay = await gladys.fake.oauthCallback('account', {
    code: 'good-code',
    state: stateParam,
    redirectUri: REDIRECT,
  });
  assert.equal(replay.success, false);
});

test('the Connect button: an unknown field and a refused code fail the callback', async () => {
  const { gladys } = await setup({ config: {} });
  assert.equal((await gladys.fake.oauthAuthorizeUrl('other', REDIRECT)).success, false);
  assert.equal((await gladys.fake.oauthAuthorizeUrl('account', undefined)).success, false);
  const url = new URL(
    (await gladys.fake.oauthAuthorizeUrl('account', REDIRECT)).data.authorize_url,
  );
  const ack = await gladys.fake.oauthCallback('account', {
    code: 'expired-code',
    state: url.searchParams.get('state'),
    redirectUri: REDIRECT,
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /invalid_grant/);
  assert.equal(gladys.fake.config[TOKEN_KEY], undefined);
});

test('the manual sign-in: the pasted address, a missing code, a used code', async () => {
  const { gladys } = await setup({ config: {} });
  const none = await gladys.fake.action(ACTIONS.SIGN_IN, { url: 'http://localhost:1/callback' });
  assert.match(none.data.message.en, /^No authorization code/);
  const used = await gladys.fake.action(ACTIONS.SIGN_IN, {
    url: 'http://localhost:1/callback?code=used-code&state=null',
  });
  assert.match(used.data.message.en, /^Navimow refused this code/);
  const ok = await gladys.fake.action(ACTIONS.SIGN_IN, {
    url: ' http://localhost:1/callback?code=good-code&state=null ',
  });
  assert.equal(
    ok.data.message.en,
    'Signed in to Navimow: 2 mowers found. Add them from the Discovery tab.',
  );
  assert.equal(fake.to('getAccessToken').at(-1).body.redirect_uri, OAUTH.MANUAL_REDIRECT_URI);
  assert.equal(gladys.fake.config[TOKEN_KEY].access_token, TOKEN.access_token);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

// --- Discovery and states --------------------------------------------------------------

test('start: the devices, their states, the live link on both mowers', async () => {
  const { gladys, broker } = await setup();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [DEVICE, 'Pelouse'],
      [DEVICE2, 'Potager'],
    ],
  );
  assert.equal(state(gladys, DEVICE, 'state'), DOCK_STATE.DOCKED);
  assert.equal(state(gladys, DEVICE, 'run_mode'), RUN_MODE.IDLE);
  assert.equal(state(gladys, DEVICE, 'battery'), 80);
  assert.equal(state(gladys, DEVICE, 'activity'), 'In the station');
  assert.equal(state(gladys, DEVICE, 'error_code'), 0);
  assert.equal(state(gladys, DEVICE, 'connected'), 1);
  assert.equal(state(gladys, DEVICE2, 'state'), DOCK_STATE.RUNNING);
  assert.equal(state(gladys, DEVICE2, 'battery'), 55);
  assert.equal(state(gladys, DEVICE2, 'connected'), 1, 'the status says online');
  assert.equal(state(gladys, DEVICE, 'progress'), undefined, 'no progress reported yet');
  assert.equal(broker.subscriptions().length, 8);
  assert.ok(broker.subscriptions().includes(topic(POTAGER, 'state')));
  // Nothing fired by the first reading.
  assert.deepEqual(gladys.fake.sceneEvents, []);
  // One status call for both mowers.
  assert.equal(fake.to('getVehicleStatus').length, 1);
});

test('live messages: state, battery, error, progress; events once per transition', async () => {
  const ctx = await setup();
  const { gladys, broker } = ctx;
  broker.deliver(topic(PELOUSE, 'state'), STATE.mowing);
  await settle();
  assert.equal(state(gladys, DEVICE, 'state'), DOCK_STATE.RUNNING);
  assert.equal(state(gladys, DEVICE, 'run_mode'), RUN_MODE.CLEANING);
  assert.equal(state(gladys, DEVICE, 'battery'), 79);
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.ACTIVITY).at(-1).data, {
    mower: DEVICE,
    mower_name: 'Pelouse',
    activity: 'mowing',
    previous_activity: 'docked',
    battery: 79,
  });

  broker.deliver(topic(PELOUSE, 'location'), [LOCATION.start, LOCATION.posture]);
  broker.deliver(topic(PELOUSE, 'location'), [LOCATION.firstPercent]);
  await settle();
  assert.equal(state(gladys, DEVICE, 'progress'), 1);
  assert.equal(state(gladys, DEVICE, 'mowed_area'), 4.21);

  broker.deliver(topic(PELOUSE, 'state'), STATE.batteryOnly);
  await settle();
  assert.equal(state(gladys, DEVICE, 'battery'), 81);
  assert.equal(
    state(gladys, DEVICE, 'state'),
    DOCK_STATE.RUNNING,
    'a battery alone keeps the state',
  );

  broker.deliver(topic(PELOUSE, 'state'), STATE.motor);
  await settle();
  assert.equal(state(gladys, DEVICE, 'state'), DOCK_STATE.ERROR);
  assert.equal(state(gladys, DEVICE, 'error_code'), 214);
  assert.equal(state(gladys, DEVICE, 'error'), 'Blade motor overload');
  assert.deepEqual(
    events(gladys, SCENE_TRIGGERS.ERROR).map((e) => e.data.code),
    [214],
  );

  broker.deliver(topic(PELOUSE, 'state'), STATE.mowing);
  broker.deliver(topic(PELOUSE, 'location'), [LOCATION.sessionDone]);
  broker.deliver(topic(PELOUSE, 'location'), [LOCATION.lateArrival]);
  await settle();
  assert.equal(state(gladys, DEVICE, 'error_code'), 0, 'a new state without error clears it');
  assert.equal(state(gladys, DEVICE, 'progress'), 100, 'the late reading is dropped');
  assert.equal(state(gladys, DEVICE, 'mowed_area'), 362.91);

  broker.deliver(topic(PELOUSE, 'state'), STATE.returning);
  broker.deliver(topic(PELOUSE, 'state'), STATE.docked);
  await settle();
  const finished = events(gladys, SCENE_TRIGGERS.FINISHED);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].data.outcome, 'complete');
  assert.equal(finished[0].data.progress, 100);
  assert.equal(events(gladys, SCENE_TRIGGERS.BACK).length, 1);
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGETS.MOWER));

  // Event and attribute messages are only logged.
  broker.deliver(topic(PELOUSE, 'event'), { type: 'system', event: 'x' });
  broker.deliver(topic(PELOUSE, 'attributes'), { attributes: { a: 1 } });
  await settle();
  assert.ok(ctx.logs.some((line) => line.startsWith('Mower event on')));
});

test('the REST status does not overwrite a live state younger than 3 minutes', async () => {
  const ctx = await setup();
  const { gladys, broker, clock } = ctx;
  broker.deliver(topic(PELOUSE, 'state'), STATE.mowing);
  await settle();
  // The REST cache still says "docked" (and 80 %).
  clock.now += 5 * MINUTE;
  broker.deliver(topic(PELOUSE, 'state'), STATE.mowing);
  await settle();
  clock.now += 2 * MINUTE;
  await tick(ctx);
  assert.equal(fake.to('getVehicleStatus').length, 2, 'the 5-minute poll ran');
  assert.equal(state(gladys, DEVICE, 'state'), DOCK_STATE.RUNNING);
  assert.equal(state(gladys, DEVICE, 'battery'), 79);
  // The live channel falls quiet (docked mowers do): REST takes over.
  clock.now += 5 * MINUTE;
  await tick(ctx);
  assert.equal(state(gladys, DEVICE, 'state'), DOCK_STATE.DOCKED);
  assert.equal(state(gladys, DEVICE, 'battery'), 80);
});

test('the poll pace: 5 minutes with the live link, 2 without, nothing in between', async () => {
  const ctx = await setup();
  const { broker, clock } = ctx;
  clock.now += 2 * MINUTE;
  await tick(ctx);
  assert.equal(fake.to('getVehicleStatus').length, 1);
  clock.now += 3 * MINUTE;
  await tick(ctx);
  assert.equal(fake.to('getVehicleStatus').length, 2);
  broker.unreachable = true;
  broker.drop();
  await settle();
  clock.now += 2 * MINUTE;
  await tick(ctx);
  assert.equal(fake.to('getVehicleStatus').length, 3);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /live updates down/);
});

test('a mower that goes offline, and back online', async () => {
  const ctx = await setup({
    overrides: {
      statuses: statusesWith(PELOUSE, (s) =>
        Object.assign(s, { online: false, vehicleState: 'Offline' }),
      ),
    },
  });
  const { gladys, broker } = ctx;
  assert.equal(state(gladys, DEVICE, 'connected'), 0);
  assert.equal(state(gladys, DEVICE, 'activity'), 'Offline');
  broker.deliver(topic(PELOUSE, 'state'), STATE.docked);
  await settle();
  assert.equal(state(gladys, DEVICE, 'connected'), 1);
  assert.equal(events(gladys, SCENE_TRIGGERS.BACK).length, 0, 'seen again, not arrived');
});

test('a new mower on a Discovery scan is subscribed too; a removed one is dropped', async () => {
  const ctx = await setup();
  const { gladys, broker } = ctx;
  const devices = fixture('devices.json');
  devices.data.payload.devices = [devices.data.payload.devices[0]];
  fake.state.devices = devices;
  await gladys.fake.scanRequest();
  await settle();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [DEVICE],
  );
  assert.equal(broker.subscriptions().length, 4);
  assert.equal(broker.clients.size, 1);
});

// --- Commands ------------------------------------------------------------------------------

test('the run mode select and the dock button send the commands, then read back', async () => {
  const ctx = await setup();
  const { gladys, timers } = ctx;
  const device = gladys.fake.discoveredDevices[0];
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  assert.equal(
    (await gladys.fake.setValue(device, feature('run_mode'), RUN_MODE.CLEANING)).success,
    true,
  );
  assert.equal(
    (await gladys.fake.setValue(device, feature('run_mode'), RUN_MODE.IDLE)).success,
    true,
  );
  assert.equal((await gladys.fake.setValue(device, feature('dock'), 1)).success, true);
  ctx.broker.deliver(topic(PELOUSE, 'state'), STATE.paused);
  await settle();
  assert.equal(
    (await gladys.fake.setValue(device, feature('run_mode'), RUN_MODE.CLEANING)).success,
    true,
  );
  assert.deepEqual(
    fake.to('sendCommands').map((c) => c.body.commands[0].execution.command),
    [
      'action.devices.commands.StartStop',
      'action.devices.commands.PauseUnpause',
      'action.devices.commands.Dock',
      'action.devices.commands.PauseUnpause',
    ],
  );
  assert.deepEqual(fake.to('sendCommands')[3].body.commands[0].execution.params, { on: true });
  // One read back for the burst.
  assert.equal(timers.timeouts().filter((t) => t.ms === COMMAND_SETTLE).length, 1);
  await timers.runTimeouts();
  await settle();
  assert.equal(fake.to('getVehicleStatus').length, 2);
  assert.equal((await gladys.fake.setValue(device, feature('run_mode'), 2)).success, false);
  assert.equal((await gladys.fake.setValue(device, feature('battery'), 1)).success, false);
  assert.equal(
    (await gladys.fake.setValue({ external_id: 'ext:navimow:thing' }, feature('dock'), 1)).success,
    false,
  );
  // No scene event comes out of a command by itself.
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.ACTIVITY).length, 1, 'only the paused message');
});

test('a command refused by the cloud fails the Gladys command', async () => {
  const { gladys } = await setup({ overrides: { command: fixture('commands-error.json') } });
  const device = gladys.fake.discoveredDevices[0];
  const ack = await gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id.endsWith(':dock')),
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /deviceOffline/);
});

test('scene actions: one mower or every mower, outputs for the next actions', async () => {
  const { gladys } = await setup();
  const one = await gladys.fake.sceneAction(SCENE_ACTIONS.START, { mower: DEVICE });
  assert.deepEqual(one.data.outputs, { mower_name: 'Pelouse', count: 1 });
  const all = await gladys.fake.sceneAction(SCENE_ACTIONS.DOCK, {});
  assert.deepEqual(all.data.outputs, { mower_name: 'Pelouse, Potager', count: 2 });
  await gladys.fake.sceneAction(SCENE_ACTIONS.PAUSE, { mower: DEVICE2 });
  await gladys.fake.sceneAction(SCENE_ACTIONS.RESUME, { mower: 'potager' });
  assert.deepEqual(
    fake
      .to('sendCommands')
      .map((c) => [c.body.commands[0].devices[0].id, c.body.commands[0].execution]),
    [
      [PELOUSE, { command: 'action.devices.commands.StartStop', params: { on: true } }],
      [PELOUSE, { command: 'action.devices.commands.Dock' }],
      [POTAGER, { command: 'action.devices.commands.Dock' }],
      [POTAGER, { command: 'action.devices.commands.PauseUnpause', params: { on: false } }],
      [POTAGER, { command: 'action.devices.commands.PauseUnpause', params: { on: true } }],
    ],
  );
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.START, {
    mower: 'ext:navimow:mower:nope',
  });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /Unknown mower/);
});

test('the widget and its buttons', async () => {
  const { gladys } = await setup();
  const ack = await gladys.fake.widgetGet(WIDGETS.MOWER, {
    settings: { mower: DEVICE2 },
    language: 'fr',
  });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  assert.equal(ack.data.content.components[0].text, 'Potager');
  const first = await gladys.fake.widgetGet(WIDGETS.MOWER, { settings: {}, language: 'en' });
  assert.equal(first.data.content.components[0].text, 'Pelouse');
  const unknown = await gladys.fake.widgetGet(WIDGETS.MOWER, { settings: { mower: 'x' } });
  assert.equal(unknown.data.content.components.length, 1);
  const tap = await gladys.fake.widgetAction(WIDGETS.MOWER, 'dock', { mower: PELOUSE });
  assert.deepEqual(tap.data, {
    message: { en: 'Pelouse: back to the station', fr: 'Pelouse : retour à la station' },
  });
  assert.equal(fake.to('sendCommands').length, 1);
  const bad = await gladys.fake.widgetAction(WIDGETS.MOWER, 'mow', { mower: PELOUSE });
  assert.match(bad.data.message.en, /^Navimow refused: unknown action/);
});

// --- Tokens ---------------------------------------------------------------------------

test('the token is renewed before it expires, stored, and the live link reconnects with it', async () => {
  const ctx = await setup();
  const { gladys, broker, clock } = ctx;
  clock.now = FIXTURE_NOW + 3600 * 1000 - TOKEN_MARGIN;
  await tick(ctx);
  assert.equal(fake.to('getAccessToken').length, 1);
  assert.equal(gladys.fake.config[TOKEN_KEY].access_token, RENEWED.access_token);
  assert.equal(gladys.fake.config[TOKEN_KEY].refresh_token, RENEWED.refresh_token);
  await settle();
  assert.equal(
    broker.last().options.wsOptions.headers.Authorization,
    `Bearer ${RENEWED.access_token}`,
  );
  assert.equal(broker.clients.size, 1);
  assert.equal(fake.to('userInfo/get/v2').length, 2, 'new broker credentials for the new token');
});

test('a token refused by the API is renewed on the spot', async () => {
  const ctx = await setup();
  fake.state.valid.delete(TOKEN.access_token);
  ctx.clock.now += 5 * MINUTE;
  await tick(ctx);
  assert.equal(fake.to('getAccessToken').length, 1);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
});

test('a refused renewal asks for a new sign-in and stops calling; Connect starts again', async () => {
  const ctx = await setup();
  const { gladys, broker, clock } = ctx;
  fake.state.refreshTokens.clear();
  clock.now = FIXTURE_NOW + 3600 * 1000;
  await tick(ctx);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^The Navimow session expired or was refused/,
  );
  assert.equal(broker.clients.size, 0, 'the live link is stopped');
  const calls = fake.calls.length;
  await tick(ctx);
  assert.equal(fake.calls.length, calls, 'nothing more until a new sign-in');
  const command = await gladys.fake.sceneAction(SCENE_ACTIONS.START, {});
  assert.equal(command.success, false);
  const test = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(test.data.message.en, /expired or was refused/);
  // Sign in again.
  const url = new URL(
    (await gladys.fake.oauthAuthorizeUrl('account', REDIRECT)).data.authorize_url,
  );
  const ack = await gladys.fake.oauthCallback('account', {
    code: 'good-code',
    state: url.searchParams.get('state'),
    redirectUri: REDIRECT,
  });
  assert.equal(ack.success, true);
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(broker.clients.size, 1);
});

test('a renewal that fails on the network is tried again, and said once the token expired', async () => {
  const ctx = await setup();
  const { gladys, clock } = ctx;
  fake.state.fail.set(
    'getAccessToken',
    new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }),
  );
  clock.now = FIXTURE_NOW + 3600 * 1000 - TOKEN_MARGIN;
  await tick(ctx);
  assert.equal(fake.to('getAccessToken').length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'the token still works');
  await tick(ctx);
  assert.equal(fake.to('getAccessToken').length, 1, 'waits before the next try');
  clock.now += TOKEN_RETRY[0];
  await tick(ctx);
  assert.equal(fake.to('getAccessToken').length, 2);
  clock.now = FIXTURE_NOW + 3600 * 1000 + TOKEN_RETRY[1];
  await tick(ctx);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^The renewal of the Navimow session failed \(ECONNRESET\)/,
  );
  fake.state.fail.clear();
  clock.now += TOKEN_RETRY[2];
  await tick(ctx);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

// --- Failures, test button, configuration ---------------------------------------------------

test('Navimow down at start: said, retried at the fallback pace, recovered', async () => {
  const ctx = await setup({
    overrides: {
      fail: new Map([
        ['authList', new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })],
      ]),
    },
  });
  const { gladys, clock } = ctx;
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: {
      en: 'Navimow is unreachable: ENOTFOUND. Retrying in a few minutes.',
      fr: 'Navimow est injoignable : ENOTFOUND. Nouvel essai dans quelques minutes.',
    },
  });
  fake.state.fail.clear();
  clock.now += 30_000;
  await tick(ctx);
  assert.equal(fake.to('authList').length, 1, 'not on every tick');
  clock.now += FALLBACK_POLL;
  await tick(ctx);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the test button lists the mowers', async () => {
  const { gladys } = await setup();
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(
    ack.data.message.en,
    [
      'Pelouse (Navimow i105E): In the station, battery 80 %.',
      'Potager (Navimow X315): Mowing, battery 55 %.',
      'Live updates: connected.',
    ].join('\n'),
  );
  assert.match(ack.data.message.fr, /^Pelouse \(Navimow i105E\) : À la station, batterie 80 %\./);
  fake.state.fail.set('authList', json({ code: 5001, desc: 'url Circuit Breaker' }));
  const down = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(
    down.data.message.en,
    /^Navimow is unreachable: Navimow answered 5001: url Circuit Breaker/,
  );
});

test('a saved configuration restarts with its language and keeps the token', async () => {
  const ctx = await setup();
  const { gladys } = ctx;
  await gladys.fake.configUpdated({ ...SIGNED_IN, language: 'fr', poll_minutes: 15 });
  await settle();
  assert.equal(gladys.fake.discoveredDevices[0].features[0].name, 'État');
  assert.match(gladys.fake.connectionStatus.message.en, /status read every 15 min/);
  assert.equal(ctx.broker.clients.size, 1);
});

test('no mower in the account: said, and looked at again every 30 minutes', async () => {
  const devices = fixture('devices.json');
  devices.data.payload.devices = [];
  const ctx = await setup({ overrides: { devices } });
  const { gladys, broker, clock } = ctx;
  assert.match(gladys.fake.connectionStatus.message.en, /the account has no mower/);
  assert.equal(broker.connections.length, 0);
  assert.equal(fake.to('getVehicleStatus').length, 0, 'no status call for no mower');
  clock.now += 10 * MINUTE;
  await tick(ctx);
  assert.equal(fake.to('authList').length, 1);
  clock.now += 20 * MINUTE;
  await tick(ctx);
  assert.equal(fake.to('authList').length, 2);
  const test = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(test.data.message.en, /^Navimow answers, but the account has no mower/);
  // A mower added in the app shows up at the next look.
  fake.state.devices = fixture('devices.json');
  clock.now += 30 * MINUTE;
  await tick(ctx);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(broker.clients.size, 1);
});

test('Gladys disconnects and comes back; the container stops', async () => {
  const ctx = await setup();
  const { gladys, broker } = ctx;
  await gladys.disconnect();
  assert.equal(broker.clients.size, 0);
  await gladys.connect();
  await settle();
  assert.equal(broker.clients.size, 1);
  await gladys.fake.shutdown();
  assert.equal(broker.clients.size, 0);
  assert.equal(ctx.timers.intervals().length, 0);
});

test('secrets never reach a log, a status, a state or a scene event', async () => {
  const ctx = await setup();
  const { gladys, broker } = ctx;
  broker.deliver(topic(PELOUSE, 'state'), STATE.mowing);
  broker.deliver(topic(PELOUSE, 'state'), STATE.stuck);
  await settle();
  await gladys.fake.action(ACTIONS.TEST, {});
  ctx.clock.now = FIXTURE_NOW + 3600 * 1000;
  await tick(ctx);
  const secrets = [
    TOKEN.access_token,
    TOKEN.refresh_token,
    RENEWED.access_token,
    RENEWED.refresh_token,
    OAUTH.CLIENT_SECRET,
    'broker-password-456',
  ];
  const visible = JSON.stringify([
    ctx.logs,
    gladys.fake.connectionStatuses,
    gladys.fake.states,
    gladys.fake.sceneEvents,
    gladys.fake.discoveredDevices,
  ]);
  for (const secret of secrets) {
    assert.ok(!visible.includes(secret), `${secret.slice(0, 8)}… leaked`);
  }
});
