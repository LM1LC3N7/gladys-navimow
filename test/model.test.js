// -----------------------------------------------------------------------------
// Navimow JSON -> plain values (src/navimow/model.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityOf,
  batteryOf,
  devicesOf,
  errorOf,
  num,
  parseTopic,
  progressOf,
  rawStateOf,
  readingOf,
  safeId,
  statusesOf,
  topicsOf,
} from '../src/navimow/model.js';
import { CHANNELS, LOCATION_AHEAD_MAX } from '../src/constants.js';
import { FIXTURE_NOW, PELOUSE, POTAGER, fixture } from './helpers/fakeNavimow.js';

const STATE = fixture('mqtt-state.json');
const LOCATION = fixture('location.json');

test('num reads numbers and numeric strings, never 0 for nothing', () => {
  assert.equal(num(42), 42);
  assert.equal(num('4.21'), 4.21);
  assert.equal(num(' 7 '), 7);
  for (const value of [null, undefined, '', '  ', 'abc', NaN, Infinity, false, [], {}]) {
    assert.equal(num(value), null, String(value));
  }
});

test('every vehicle state of the cloud maps to an activity', () => {
  const cases = {
    isRunning: 'mowing',
    isMapping: 'mapping',
    isPaused: 'paused',
    isDocking: 'returning',
    isDocked: 'docked',
    isIdle: 'idle',
    isIdel: 'idle',
    isLifted: 'lifted',
    Error: 'error',
    error: 'error',
    inSoftwareUpdate: 'updating',
    'Self-Checking': 'self_check',
    'Self-checking': 'self_check',
    Offline: 'offline',
    offline: 'offline',
    charging: 'charging',
    mowing: 'mowing',
    somethingNew: 'unknown',
  };
  for (const [raw, activity] of Object.entries(cases)) {
    assert.equal(activityOf(raw), activity, raw);
  }
  assert.equal(activityOf(null), 'unknown');
  assert.equal(activityOf('isDocked', { charging: true }), 'charging');
  assert.equal(activityOf('isDocked', { charging: false }), 'docked');
  assert.equal(activityOf('isRunning', { charging: true }), 'mowing');
});

test('the state is `state` over MQTT and `vehicleState` over REST', () => {
  assert.equal(rawStateOf(STATE.mowing), 'isRunning');
  assert.equal(rawStateOf({ vehicleState: 'isDocked' }), 'isDocked');
  assert.equal(rawStateOf({ status: 'isPaused' }), 'isPaused');
  // A Google QUERY result status is not a vehicle state.
  assert.equal(rawStateOf({ status: 'SUCCESS', vehicleState: 'isDocked' }), 'isDocked');
  assert.equal(rawStateOf({ status: 'SUCCESS' }), null);
  assert.equal(rawStateOf(STATE.batteryOnly), null);
  assert.equal(rawStateOf({ state: '  ' }), null);
});

test('the battery: battery, else the PERCENTAGE capacity, else the first one, else null', () => {
  assert.equal(batteryOf(STATE.mowing), 79);
  assert.equal(batteryOf({ capacityRemaining: [{ rawValue: 80, unit: 'PERCENTAGE' }] }), 80);
  assert.equal(
    batteryOf({
      capacityRemaining: [
        { rawValue: 3600, unit: 'SECONDS' },
        { rawValue: '64', unit: 'percentage' },
      ],
    }),
    64,
  );
  assert.equal(batteryOf({ capacityRemaining: [{ rawValue: 33 }] }), 33);
  assert.equal(batteryOf({ battery: 140 }), 100);
  assert.equal(batteryOf({}), null, 'no battery is not 0 %');
  assert.equal(batteryOf({ capacityRemaining: [] }), null);
});

test('errors: nested, flat, codes, messages, and "none"', () => {
  assert.equal(errorOf(STATE.mowing), undefined, 'says nothing about an error');
  assert.deepEqual(errorOf(STATE.stuck), { code: 'stuck', message: null });
  assert.deepEqual(errorOf(STATE.motor), { code: 214, message: 'Blade motor overload' });
  assert.equal(errorOf({ error_code: 'none' }), null);
  assert.equal(errorOf({ error: null }), null);
  assert.equal(errorOf({ error: { code: 0 } }), null);
  assert.deepEqual(errorOf({ error_code: 'RAIN', error_message: 'Rain detected' }), {
    code: 'rain',
    message: 'Rain detected',
  });
  assert.deepEqual(errorOf({ errorCode: '108' }), { code: 108, message: null });
  assert.deepEqual(errorOf({ error: 'blade_error' }), { code: 'blade_error', message: null });
  assert.deepEqual(errorOf({ error_code: 'none', errorMsg: 'Check the blades' }), {
    code: null,
    message: 'Check the blades',
  });
});

test('authList -> mowers', () => {
  const mowers = devicesOf(fixture('devices.json').data);
  assert.deepEqual(mowers, [
    {
      id: PELOUSE,
      name: 'Pelouse',
      model: 'Navimow i105E',
      firmware: '1.4.2',
      serial: 'N1E0A7C2B9F4D3',
      online: true,
    },
    {
      id: POTAGER,
      name: 'Potager',
      model: 'Navimow X315',
      firmware: '2.0.1',
      serial: 'N3X0B1D4E7A2C9',
      online: false,
    },
  ]);
  // Google's SYNC shape and missing names.
  assert.deepEqual(
    devicesOf({
      payload: {
        devices: [
          { id: 'A1', name: { name: 'Front' }, deviceInfo: { model: 'i108E', swVersion: '9' } },
          { id: 'B2C3D4E5F6' },
          { name: 'no id' },
          null,
        ],
      },
    }).map((m) => [m.id, m.name, m.model, m.firmware]),
    [
      ['A1', 'Front', 'i108E', '9'],
      ['B2C3D4E5F6', 'Navimow D4E5F6', null, null],
    ],
  );
  assert.deepEqual(devicesOf(undefined), []);
});

test('getVehicleStatus -> readings by id', () => {
  const statuses = statusesOf(fixture('statuses.json').data);
  assert.deepEqual([...statuses.keys()], [PELOUSE, POTAGER]);
  assert.deepEqual(statuses.get(PELOUSE), {
    rawState: 'isDocked',
    battery: 80,
    charging: null,
    online: true,
    error: null,
  });
  assert.equal(statuses.get(POTAGER).error, undefined);
  assert.equal(statusesOf({}).size, 0);
});

test('an MQTT state message -> a reading', () => {
  assert.deepEqual(readingOf(STATE.batteryOnly), {
    rawState: null,
    battery: 81,
    charging: null,
    online: null,
    error: undefined,
  });
  assert.equal(readingOf({ state: 'isDocked', isCharging: true }).charging, true);
});

test('topics: the cloud spelling, a leading slash, the channel last', () => {
  assert.deepEqual(parseTopic(`/downlink/vehicle/${PELOUSE}/realtimeDate/state`), {
    deviceId: PELOUSE,
    channel: 'state',
  });
  assert.deepEqual(parseTopic('downlink/vehicle/X/realtimeData/location'), {
    deviceId: 'X',
    channel: 'location',
  });
  assert.equal(parseTopic('navimow/X/command'), null);
  assert.equal(parseTopic(undefined), null);
  assert.deepEqual(topicsOf('X', CHANNELS), [
    '/downlink/vehicle/X/realtimeDate/state',
    '/downlink/vehicle/X/realtimeDate/event',
    '/downlink/vehicle/X/realtimeDate/attributes',
    '/downlink/vehicle/X/realtimeDate/location',
  ]);
});

test('the mowing progress of the recorded location readings', () => {
  const seen = new Map();
  const now = LOCATION.sessionDone.time;
  assert.deepEqual(progressOf([LOCATION.firstPercent], seen, now, LOCATION_AHEAD_MAX), {
    percentage: 1,
    area: 4.21,
    weekArea: 738.24,
    time: LOCATION.firstPercent.time,
  });
  // A position alone is no progress.
  assert.equal(progressOf([LOCATION.posture], seen, now, LOCATION_AHEAD_MAX), null);
  assert.deepEqual(progressOf([LOCATION.sessionDone], seen, now, LOCATION_AHEAD_MAX), {
    percentage: 100,
    area: 362.91,
    weekArea: 1096.92,
    time: LOCATION.sessionDone.time,
  });
  // Delivered 1 h 45 late (ioBroker.navimow saw it): older than the newest one, dropped.
  assert.equal(progressOf([LOCATION.lateArrival], seen, now, LOCATION_AHEAD_MAX), null);
  // A message with a position and a progress: the progress counts.
  const later = { ...LOCATION.firstPercent, time: now + 1000, mowingPercentage: 3 };
  assert.equal(progressOf([LOCATION.posture, later], seen, now, LOCATION_AHEAD_MAX).percentage, 3);
});

test('a reading from a clock far ahead does not lock the real ones out', () => {
  const seen = new Map();
  const now = FIXTURE_NOW;
  const ahead = { ...LOCATION.firstPercent, time: now + 24 * 60 * 60_000 };
  assert.equal(progressOf(ahead, seen, now, LOCATION_AHEAD_MAX).percentage, 1);
  const real = { ...LOCATION.sessionDone, time: now };
  assert.equal(progressOf(real, seen, now, LOCATION_AHEAD_MAX).percentage, 100);
  // Without a time or a type, a reading cannot be placed: it counts.
  assert.equal(
    progressOf({ mowingPercentage: 40, subtotalArea: '' }, seen, now, LOCATION_AHEAD_MAX)
      .percentage,
    40,
  );
  assert.equal(progressOf({ subtotalArea: '239.99', type: 2 }, seen, now, 0).area, 239.99);
  assert.equal(progressOf([null, 'x'], seen, now, 0), null);
});

test('safeId keeps a Navimow id usable in an external id', () => {
  assert.equal(safeId(PELOUSE), PELOUSE);
  assert.equal(safeId(POTAGER), 'NVM-X3_potager');
  assert.equal(safeId('a:b c'), 'a_b_c');
});
