// -----------------------------------------------------------------------------
// The Gladys device of a mower and its states (src/devices.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  FEATURE,
  buildMowerDevice,
  dockStateOf,
  errorCodeOf,
  errorLabel,
  featureKeyOf,
  ids,
  mowerStates,
  parseExternalId,
  runModeOf,
} from '../src/devices.js';
import { ACTIVITIES, DOCK_STATE, RUN_MODE } from '../src/constants.js';
import { PELOUSE, POTAGER, POTAGER_SAFE } from './helpers/fakeNavimow.js';

const MOWER = {
  id: PELOUSE,
  name: 'Pelouse',
  model: 'Navimow i105E',
  firmware: '1.4.2',
  serial: 'N1E0A7C2B9F4D3',
  activity: 'mowing',
  battery: 79,
  error: null,
  connected: true,
  progress: 42,
  area: 176.5,
};

test('one device per mower, with stable ids, the vacuum-cleaner trio and the sensors', async () => {
  const gladys = createFakeGladys({ selector: 'navimow' });
  const device = buildMowerDevice(gladys, MOWER, 'en');
  assert.equal(device.external_id, `ext:navimow:mower:${PELOUSE}`);
  assert.equal(device.name, 'Pelouse');
  assert.deepEqual(
    device.features.map((f) => [featureKeyOf(f.external_id), f.category, f.type, f.read_only]),
    [
      ['state', 'vacuum-cleaner', 'state', true],
      ['run_mode', 'vacuum-cleaner', 'run-mode', false],
      ['dock', 'vacuum-cleaner', 'dock', false],
      ['battery', 'battery', 'integer', true],
      ['activity', 'text', 'text', true],
      ['error_code', 'unknown', 'integer', true],
      ['error', 'text', 'text', true],
      ['connected', 'unknown', 'binary', true],
      ['progress', 'unknown', 'integer', true],
      ['mowed_area', 'surface', 'decimal', true],
    ],
  );
  assert.deepEqual(
    device.features.find((f) => f.external_id.endsWith(':run_mode')).supported_options,
    [
      { value: RUN_MODE.IDLE, label: { en: 'Pause', fr: 'Pause' }, sort_order: 1 },
      { value: RUN_MODE.CLEANING, label: { en: 'Mow', fr: 'Tondre' }, sort_order: 2 },
    ],
  );
  assert.deepEqual(device.params, [
    { name: 'mower_id', value: PELOUSE },
    { name: 'model', value: 'Navimow i105E' },
    { name: 'serial_number', value: 'N1E0A7C2B9F4D3' },
    { name: 'firmware', value: '1.4.2' },
  ]);
  assert.equal(device.features[0].name, 'State');
  assert.equal(buildMowerDevice(gladys, MOWER, 'fr').features[0].name, 'État');
  // The fake Gladys of the SDK checks the categories, types and units like Gladys.
  await gladys.publishDiscoveredDevices([
    device,
    buildMowerDevice(gladys, { ...MOWER, id: POTAGER, name: 'Potager', model: null }, 'fr'),
  ]);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('an id with other characters still makes a valid, parseable external id', () => {
  const gladys = createFakeGladys({ selector: 'navimow' });
  const id = ids.mower(gladys, POTAGER);
  assert.equal(id, `ext:navimow:mower:${POTAGER_SAFE}`);
  assert.equal(parseExternalId(id), POTAGER_SAFE);
  assert.equal(parseExternalId(`${id}:dock`), undefined);
  assert.equal(parseExternalId('ext:other:thing'), undefined);
  assert.equal(featureKeyOf(`${id}:dock`), 'dock');
});

test('every activity has a Gladys state; only mowing runs', () => {
  const expected = {
    mowing: DOCK_STATE.RUNNING,
    mapping: DOCK_STATE.RUNNING,
    paused: DOCK_STATE.PAUSED,
    returning: DOCK_STATE.RETURNING,
    docked: DOCK_STATE.DOCKED,
    charging: DOCK_STATE.CHARGING,
    idle: DOCK_STATE.STOPPED,
    lifted: DOCK_STATE.ERROR,
    error: DOCK_STATE.ERROR,
    updating: DOCK_STATE.STOPPED,
    self_check: DOCK_STATE.STOPPED,
    offline: DOCK_STATE.STOPPED,
    unknown: DOCK_STATE.STOPPED,
  };
  assert.deepEqual(Object.keys(expected), ACTIVITIES);
  for (const [activity, state] of Object.entries(expected)) {
    assert.equal(dockStateOf({ activity }), state, activity);
    assert.equal(
      runModeOf({ activity }),
      state === DOCK_STATE.RUNNING ? RUN_MODE.CLEANING : RUN_MODE.IDLE,
      activity,
    );
  }
});

test('the error: code, message, kind, activity', () => {
  assert.equal(errorCodeOf(MOWER), 0);
  assert.deepEqual(errorLabel(MOWER), { en: '—', fr: '—' });
  const lifted = { ...MOWER, activity: 'lifted' };
  assert.equal(errorCodeOf(lifted), -1);
  assert.deepEqual(errorLabel(lifted), { en: 'Lifted', fr: 'Soulevée' });
  const stuck = { ...MOWER, activity: 'error', error: { code: 'stuck', message: null } };
  assert.equal(errorCodeOf(stuck), -1);
  assert.deepEqual(errorLabel(stuck), { en: 'Stuck', fr: 'Coincée' });
  const motor = {
    ...MOWER,
    activity: 'error',
    error: { code: 214, message: 'Blade motor overload' },
  };
  assert.equal(errorCodeOf(motor), 214);
  assert.deepEqual(errorLabel(motor), { en: 'Blade motor overload', fr: 'Blade motor overload' });
  const coded = { ...MOWER, error: { code: 108, message: null } };
  assert.equal(errorCodeOf(coded), 108);
  assert.deepEqual(errorLabel(coded), { en: 'Error 108', fr: 'Erreur 108' });
  const odd = { ...MOWER, error: { code: 'brand_new', message: null } };
  assert.deepEqual(errorLabel(odd), { en: 'brand_new', fr: 'brand_new' });
});

test('the states of a mower, in the chosen language', () => {
  const deviceId = `ext:navimow:mower:${PELOUSE}`;
  const states = mowerStates(deviceId, MOWER, 'fr');
  const byKey = Object.fromEntries(
    states.map((s) => [featureKeyOf(s.device_feature_external_id), s.text ?? s.state]),
  );
  assert.deepEqual(byKey, {
    [FEATURE.STATE]: DOCK_STATE.RUNNING,
    [FEATURE.RUN_MODE]: RUN_MODE.CLEANING,
    [FEATURE.BATTERY]: 79,
    [FEATURE.ACTIVITY]: 'Tonte',
    [FEATURE.ERROR_CODE]: 0,
    [FEATURE.ERROR]: '—',
    [FEATURE.CONNECTED]: 1,
    [FEATURE.PROGRESS]: 42,
    [FEATURE.MOWED_AREA]: 176.5,
  });
  // Unknown values are not published (never a made-up 0).
  const sparse = mowerStates(
    deviceId,
    { ...MOWER, battery: null, connected: null, progress: null, area: null, activity: 'unknown' },
    'en',
  );
  assert.deepEqual(
    sparse.map((s) => featureKeyOf(s.device_feature_external_id)),
    ['state', 'run_mode', 'activity', 'error_code', 'error'],
  );
  assert.equal(
    mowerStates(deviceId, { ...MOWER, connected: false }, 'en').find((s) =>
      s.device_feature_external_id.endsWith(':connected'),
    ).state,
    0,
  );
});
