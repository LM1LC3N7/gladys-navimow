// -----------------------------------------------------------------------------
// Readings and transitions -> scene events (src/triggers.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mowerEvents, nextReading } from '../src/triggers.js';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { FIXTURE_NOW, PELOUSE } from './helpers/fakeNavimow.js';

const DEVICE = `ext:navimow:mower:${PELOUSE}`;
const MINUTE = 60_000;
const BASE = {
  id: PELOUSE,
  name: 'Pelouse',
  activity: 'docked',
  battery: 100,
  error: null,
  connected: true,
  progress: null,
  area: null,
  progressAt: null,
};

/** Feed a list of [minute, overrides] and collect the events. */
function play(steps) {
  let previous;
  const events = [];
  for (const [minute, overrides] of steps) {
    const reading = nextReading(previous, { ...BASE, ...overrides }, FIXTURE_NOW + minute * MINUTE);
    events.push(...mowerEvents(DEVICE, previous, reading));
    previous = reading;
  }
  return { events, last: previous };
}

const keys = (events) => events.map((e) => e.key);

test('the first reading fires nothing', () => {
  assert.deepEqual(play([[0, { activity: 'error', error: { code: 9, message: 'x' } }]]).events, []);
});

test('a whole session: start, progress, back home complete', () => {
  const { events } = play([
    [0, { activity: 'docked' }],
    [1, { activity: 'mowing', battery: 99 }],
    [50, { activity: 'mowing', progress: 60, progressAt: FIXTURE_NOW + 50 * MINUTE }],
    [
      90,
      {
        activity: 'returning',
        battery: 35,
        progress: 100,
        area: 362.91,
        progressAt: FIXTURE_NOW + 89 * MINUTE,
      },
    ],
    [
      95,
      {
        activity: 'charging',
        battery: 34,
        progress: 100,
        area: 362.91,
        progressAt: FIXTURE_NOW + 89 * MINUTE,
      },
    ],
  ]);
  assert.deepEqual(keys(events), [
    SCENE_TRIGGERS.ACTIVITY,
    SCENE_TRIGGERS.ACTIVITY,
    SCENE_TRIGGERS.ACTIVITY,
    SCENE_TRIGGERS.FINISHED,
    SCENE_TRIGGERS.BACK,
  ]);
  assert.deepEqual(events[0].data, {
    mower: DEVICE,
    mower_name: 'Pelouse',
    activity: 'mowing',
    previous_activity: 'docked',
    battery: 99,
  });
  assert.deepEqual(events[3].data, {
    mower: DEVICE,
    mower_name: 'Pelouse',
    outcome: 'complete',
    activity: 'charging',
    minutes: 94,
    progress: 100,
    area: 362.91,
    battery: 34,
    finished_at: new Date(FIXTURE_NOW + 95 * MINUTE).toISOString(),
  });
  assert.deepEqual(events[4].data, {
    mower: DEVICE,
    mower_name: 'Pelouse',
    previous_activity: 'returning',
    battery: 34,
    progress: 100,
  });
});

test('a charging break is an interrupted session; a progress from before does not count', () => {
  const { events } = play([
    [0, { activity: 'docked', progress: 100, progressAt: FIXTURE_NOW }],
    [10, { activity: 'mowing', progress: 100, progressAt: FIXTURE_NOW }],
    [40, { activity: 'docked', progress: 100, progressAt: FIXTURE_NOW }],
    [100, { activity: 'mowing', progress: 100, progressAt: FIXTURE_NOW }],
    [130, { activity: 'mowing', progress: 45, progressAt: FIXTURE_NOW + 125 * MINUTE }],
    [140, { activity: 'docked', progress: 45, progressAt: FIXTURE_NOW + 125 * MINUTE }],
  ]);
  const finished = events.filter((e) => e.key === SCENE_TRIGGERS.FINISHED).map((e) => e.data);
  assert.deepEqual(
    finished.map((d) => [d.outcome, d.progress, d.minutes]),
    [
      ['unknown', null, 30],
      ['interrupted', 45, 40],
    ],
  );
});

test('a session seen from its middle has no length; idle ends it too', () => {
  const { events } = play([
    [0, { activity: 'mowing' }],
    [5, { activity: 'paused' }],
    [6, { activity: 'mowing' }],
    [20, { activity: 'idle' }],
  ]);
  const finished = events.find((e) => e.key === SCENE_TRIGGERS.FINISHED);
  assert.equal(finished.data.minutes, null);
  assert.equal(finished.data.activity, 'idle');
  assert.equal(events.filter((e) => e.key === SCENE_TRIGGERS.FINISHED).length, 1);
  assert.equal(
    events.filter((e) => e.key === SCENE_TRIGGERS.BACK).length,
    0,
    'idle is not the station',
  );
});

test('a lift during a session: an error, then the session goes on', () => {
  const { events } = play([
    [0, { activity: 'docked' }],
    [1, { activity: 'mowing' }],
    [10, { activity: 'lifted' }],
    [11, { activity: 'lifted' }],
    [12, { activity: 'mowing' }],
    [60, { activity: 'docked' }],
  ]);
  const errors = events.filter((e) => e.key === SCENE_TRIGGERS.ERROR);
  assert.equal(errors.length, 1, 'once per error');
  assert.deepEqual(errors[0].data, {
    mower: DEVICE,
    mower_name: 'Pelouse',
    code: -1,
    error_en: 'Lifted',
    error_fr: 'Soulevée',
    activity: 'lifted',
    battery: 100,
  });
  const finished = events.filter((e) => e.key === SCENE_TRIGGERS.FINISHED);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].data.minutes, 59);
});

test('a new error code or message fires again; the same one does not', () => {
  const { events, last } = play([
    [0, { activity: 'mowing' }],
    [1, { activity: 'error', error: { code: 'stuck', message: null } }],
    [2, { activity: 'error', error: { code: 'stuck', message: null } }],
    [3, { activity: 'error', error: { code: 214, message: 'Blade motor overload' } }],
    [4, { activity: 'mowing', error: null }],
    [5, { activity: 'error', error: { code: 214, message: 'Blade motor overload' } }],
  ]);
  const errors = events.filter((e) => e.key === SCENE_TRIGGERS.ERROR).map((e) => e.data);
  assert.deepEqual(
    errors.map((d) => [d.code, d.error_en]),
    [
      [-1, 'Stuck'],
      [214, 'Blade motor overload'],
      [214, 'Blade motor overload'],
    ],
  );
  assert.equal(last.lastError.code, 214);
});

test('the last error is kept for the widget once the mower recovers', () => {
  const { last } = play([
    [0, { activity: 'mowing' }],
    [1, { activity: 'lifted' }],
    [2, { activity: 'mowing' }],
  ]);
  assert.deepEqual(last.lastError, {
    code: -1,
    label: { en: 'Lifted', fr: 'Soulevée' },
    at: FIXTURE_NOW + MINUTE,
  });
});

test('coming back online in the station is not an arrival', () => {
  const { events } = play([
    [0, { activity: 'offline' }],
    [5, { activity: 'docked' }],
    [6, { activity: 'unknown' }],
    [7, { activity: 'charging' }],
  ]);
  assert.deepEqual(keys(events), [
    SCENE_TRIGGERS.ACTIVITY,
    SCENE_TRIGGERS.ACTIVITY,
    SCENE_TRIGGERS.ACTIVITY,
  ]);
});

test('docked <-> charging is not an arrival either; returning home is', () => {
  const { events } = play([
    [0, { activity: 'docked' }],
    [1, { activity: 'charging' }],
    [2, { activity: 'docked' }],
    [3, { activity: 'paused' }],
    [4, { activity: 'returning' }],
    [5, { activity: 'docked' }],
  ]);
  assert.equal(events.filter((e) => e.key === SCENE_TRIGGERS.BACK).length, 1);
  assert.equal(
    events.filter((e) => e.key === SCENE_TRIGGERS.FINISHED).length,
    0,
    'no mowing in between: no session',
  );
});

test('every event stays within 30 flat keys', () => {
  const { events } = play([
    [0, { activity: 'docked' }],
    [1, { activity: 'mowing' }],
    [2, { activity: 'error', error: { code: 1, message: 'x' } }],
    [3, { activity: 'docked' }],
  ]);
  for (const event of events) {
    assert.ok(Object.keys(event.data).length <= 30);
    for (const value of Object.values(event.data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
    }
  }
});
