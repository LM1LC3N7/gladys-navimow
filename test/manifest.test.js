// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCOUNT_KEY,
  ACTIONS,
  ACTIVITIES,
  LANGUAGES,
  MANUAL_SIGN_IN_URL,
  OUTCOMES,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  TOKEN_KEY,
  WIDGETS,
} from '../src/constants.js';
import { BOUNDS, DEFAULTS } from '../src/config.js';
import { mowerEvents, nextReading } from '../src/triggers.js';
import { FIXTURE_NOW } from './helpers/fakeNavimow.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length <= 30, 'the store refuses a name over 30 characters');
  assert.equal(manifest.location, undefined, 'no house location needed');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-navimow:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-navimow/main/cover.png',
  );
  assert.deepEqual(manifest.categories, ['appliances']);
  assert.deepEqual(manifest.transports, ['cloud']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(manifest.config_schema[0].description[lang], /Unofficial|non officiel/);
    assert.match(read(`docs/${lang}.md`), /not affiliated with Segway|sans lien avec Segway/);
  }
  for (const widget of manifest.widgets) {
    for (const lang of ['en', 'fr']) {
      const length = widget.description[lang].length;
      assert.ok(length <= 100, `widget ${widget.key} description.${lang}: ${length} characters`);
    }
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  for (const field of manifest.config_schema) {
    for (const link of field.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
    if (field.type === 'section') {
      for (const lang of ['en', 'fr']) {
        assert.ok(field.description[lang].length <= 1000, `${field.key}.${lang} too long`);
      }
    }
  }
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields[ACCOUNT_KEY].type, 'oauth2');
  assert.equal(fields[ACCOUNT_KEY].default, undefined);
  assert.equal(fields[TOKEN_KEY], undefined, 'the token lives outside the config_schema');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
    if (BOUNDS[key]) {
      assert.deepEqual([fields[key].min, fields[key].max], BOUNDS[key], key);
    }
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    fields.manual_sign_in.links.map((l) => l.url),
    [MANUAL_SIGN_IN_URL],
  );
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(handlers.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  const triggers = Object.fromEntries(manifest.scene_triggers.map((t) => [t.key, t]));
  assert.deepEqual(
    triggers[SCENE_TRIGGERS.ACTIVITY].fields
      .find((f) => f.key === 'activity')
      .options.map((o) => o.value),
    ACTIVITIES,
  );
  assert.deepEqual(
    triggers[SCENE_TRIGGERS.FINISHED].fields
      .find((f) => f.key === 'outcome')
      .options.map((o) => o.value),
    OUTCOMES,
  );
  for (const action of manifest.scene_actions) {
    assert.deepEqual(
      action.outputs.map((o) => o.key),
      ['mower_name', 'count'],
    );
    assert.equal(action.fields[0].required, false, 'empty mower field: every mower');
  }
});

test('every trigger field and variable is a key of the events the code fires', () => {
  const base = {
    id: 'X',
    name: 'Pelouse',
    battery: 90,
    error: null,
    connected: true,
    progress: null,
    area: null,
    progressAt: null,
  };
  const steps = [
    { activity: 'docked' },
    { activity: 'mowing' },
    { activity: 'error', error: { code: 9, message: 'x' } },
    { activity: 'returning' },
    { activity: 'docked', progress: 100, area: 300, progressAt: FIXTURE_NOW + 3 * 60_000 },
  ];
  let previous;
  const events = [];
  steps.forEach((overrides, i) => {
    const reading = nextReading(previous, { ...base, ...overrides }, FIXTURE_NOW + i * 60_000);
    events.push(...mowerEvents('ext:navimow:mower:X', previous, reading));
    previous = reading;
  });
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `${trigger.key} is fired by the code`);
    for (const { key } of [...trigger.fields, ...trigger.variables]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
    assert.ok(Object.keys(event.data).length <= 30);
  }
});
