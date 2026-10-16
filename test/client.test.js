// -----------------------------------------------------------------------------
// The REST client (src/navimow/client.js) against the fake Navimow cloud.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NavimowAuth, tokenOf } from '../src/navimow/auth.js';
import { NavimowClient } from '../src/navimow/client.js';
import {
  FIXTURE_NOW,
  PELOUSE,
  POTAGER,
  RENEWED,
  TOKEN,
  fixture,
  installNavimow,
  json,
} from './helpers/fakeNavimow.js';

let fake;
afterEach(() => fake?.restore());

function setup(overrides) {
  fake = installNavimow(overrides);
  const auth = new NavimowAuth({ now: () => FIXTURE_NOW });
  auth.load(tokenOf(TOKEN, FIXTURE_NOW));
  return { auth, client: new NavimowClient({ auth }) };
}

test('the device list, with the bearer token and a request id', async () => {
  const { client } = setup();
  const mowers = await client.devices();
  assert.deepEqual(
    mowers.map((m) => m.id),
    [PELOUSE, POTAGER],
  );
  const [call] = fake.calls;
  assert.equal(call.host, 'navimow-fra.ninebot.com');
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN.access_token}`);
  assert.match(call.headers.requestId, /^[0-9a-f-]{36}$/);
  assert.match(call.headers['User-Agent'], /^gladys-navimow\//);
});

test('the statuses of every mower in one call', async () => {
  const { client } = setup();
  const statuses = await client.statuses([PELOUSE, POTAGER]);
  assert.equal(statuses.get(PELOUSE).rawState, 'isDocked');
  assert.equal(statuses.get(POTAGER).battery, 55);
  const [call] = fake.to('getVehicleStatus');
  assert.deepEqual(call.body, { devices: [{ id: PELOUSE }, { id: POTAGER }] });
  assert.equal((await client.statuses([])).size, 0);
  assert.equal(fake.to('getVehicleStatus').length, 1, 'no call for no mower');
});

test('the commands are the Google traits navimow-sdk sends', async () => {
  const { client } = setup();
  for (const name of ['start', 'pause', 'resume', 'dock']) {
    await client.command(PELOUSE, name);
  }
  assert.deepEqual(
    fake.to('sendCommands').map((c) => c.body),
    [
      {
        commands: [
          {
            devices: [{ id: PELOUSE }],
            execution: { command: 'action.devices.commands.StartStop', params: { on: true } },
          },
        ],
      },
      {
        commands: [
          {
            devices: [{ id: PELOUSE }],
            execution: { command: 'action.devices.commands.PauseUnpause', params: { on: false } },
          },
        ],
      },
      {
        commands: [
          {
            devices: [{ id: PELOUSE }],
            execution: { command: 'action.devices.commands.PauseUnpause', params: { on: true } },
          },
        ],
      },
      {
        commands: [
          { devices: [{ id: PELOUSE }], execution: { command: 'action.devices.commands.Dock' } },
        ],
      },
    ],
  );
  await assert.rejects(client.command(PELOUSE, 'mow'), /Unknown command/);
});

test('a command already in effect is done; a refused one says why', async () => {
  const { client } = setup({ command: fixture('commands-already.json') });
  await client.command(PELOUSE, 'start');
  fake.state.command = fixture('commands-error.json');
  await assert.rejects(client.command(PELOUSE, 'start'), {
    code: 'command',
    message: 'Navimow refused start: deviceOffline',
  });
});

test('a refused token (4005) is renewed once and the call replayed', async () => {
  const { client, auth } = setup();
  fake.state.valid.delete(TOKEN.access_token);
  const mowers = await client.devices();
  assert.equal(mowers.length, 2);
  assert.equal(auth.token.accessToken, RENEWED.access_token);
  assert.deepEqual(
    fake.calls.map((c) => c.path),
    ['/openapi/smarthome/authList', '/openapi/oauth/getAccessToken', '/openapi/smarthome/authList'],
  );
});

test('a token still refused after a renewal is a sign-in problem', async () => {
  const { client } = setup();
  fake.state.valid.clear();
  await assert.rejects(client.devices(), {
    code: 'token',
    message: 'Navimow refused the token (CODE_OAUTH_INFO_ILLEGAL)',
  });
});

test('an HTTP 401 is renewed once too', async () => {
  const { client } = setup();
  fake.state.fail.set('authList', json({ message: 'Unauthorized' }, 401));
  fake.state.failOnce = true;
  assert.equal((await client.devices()).length, 2);
});

test('other answers: an API code, a gateway, the network', async () => {
  const { client } = setup();
  fake.state.fail.set('authList', json({ code: 5001, desc: 'url Circuit Breaker' }));
  await assert.rejects(client.devices(), {
    code: 'api',
    message: 'Navimow answered 5001: url Circuit Breaker',
  });
  fake.state.fail.set('authList', json('<html><title>502 Bad Gateway</title></html>', 502));
  await assert.rejects(client.devices(), {
    code: 'unreachable',
    message: 'HTTP 502 on /openapi/smarthome/authList: 502 Bad Gateway',
  });
  fake.state.fail.set('authList', new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } }));
  await assert.rejects(client.devices(), { code: 'unreachable', message: 'EAI_AGAIN' });
  fake.state.fail.set('authList', new Response('not json', { status: 200 }));
  await assert.rejects(client.devices(), { code: 'api' });
});

test('the MQTT broker and credentials', async () => {
  const { client } = setup();
  assert.deepEqual(await client.mqttInfo(), fixture('mqtt-info.json').data);
});
