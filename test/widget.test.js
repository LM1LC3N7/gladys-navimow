// -----------------------------------------------------------------------------
// The "mower" dashboard widget (src/widget.js), checked against the SDK's
// own validator of the widget vocabulary and content budget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { mowerWidget } from '../src/widget.js';
import { nextReading } from '../src/triggers.js';
import { WIDGET_ACTIONS } from '../src/constants.js';
import { FIXTURE_NOW, PELOUSE } from './helpers/fakeNavimow.js';

const MOWER = {
  id: PELOUSE,
  name: 'Pelouse',
  activity: 'mowing',
  battery: 79,
  error: null,
  connected: true,
  progress: 42,
  area: 176.5,
};

const reading = (overrides = {}, previous) =>
  nextReading(previous, { ...MOWER, ...overrides }, FIXTURE_NOW);

test('a mower: heading, battery, progress, status rows and four buttons, within the budget', () => {
  const content = mowerWidget({ reading: reading(), live: true, language: 'fr' });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.ttl_seconds, 60, 'a running mower is refreshed every minute');
  const [heading, battery, progress, status, ...buttons] = content.components;
  assert.equal(heading.text, 'Pelouse');
  assert.equal(battery.value, 79);
  assert.equal(progress.value, 42);
  assert.deepEqual(
    status.items.map((i) => i.value),
    ['Tonte', 'Aucune', 'En ligne', 'Actives'],
  );
  assert.deepEqual(
    buttons.map((b) => b.action),
    [
      { key: WIDGET_ACTIONS.START, params: { mower: PELOUSE } },
      { key: WIDGET_ACTIONS.PAUSE, params: { mower: PELOUSE } },
      { key: WIDGET_ACTIONS.RESUME, params: { mower: PELOUSE } },
      { key: WIDGET_ACTIONS.DOCK, params: { mower: PELOUSE } },
    ],
  );
});

test('unknown values, an error, the last error, offline, a docked mower', () => {
  const sparse = mowerWidget({
    reading: reading({ battery: null, progress: null, activity: 'docked', connected: false }),
    language: 'en',
  });
  assert.deepEqual(validateWidgetContent(sparse), []);
  assert.equal(sparse.ttl_seconds, 300);
  assert.equal(sparse.components[1].value, '—');
  assert.equal(sparse.components[2].value, '—');
  assert.deepEqual(
    sparse.components[3].items.map((i) => i.value),
    ['In the station', 'None', 'Offline', 'Off'],
  );
  const lifted = reading({ activity: 'lifted', battery: 15 });
  const error = mowerWidget({ reading: lifted, language: 'en' });
  assert.deepEqual(validateWidgetContent(error), []);
  assert.equal(error.components[1].color, 'danger');
  assert.equal(error.components[3].items[1].value, 'Lifted');
  const recovered = mowerWidget({
    reading: reading({ activity: 'mowing', battery: 40 }, lifted),
    language: 'en',
  });
  assert.equal(recovered.components[3].items[1].label.en, 'Last error');
  assert.equal(recovered.components[3].items[1].value, 'Lifted · 12:00 UTC');
  assert.equal(recovered.components[1].color, 'warning');
});

test('no mower yet: a short text', () => {
  const content = mowerWidget({ reading: undefined });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.length, 1);
});
