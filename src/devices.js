// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External id (forever):  mower:<Navimow device id>   one robotic mower
//
// Like LM1LC3N7/gladys-automower, the operational state and the two commands
// use Gladys' `vacuum-cleaner` category, the only one describing a robot that
// runs, docks and charges: its device card labels the state Stopped /
// Running / Paused / Error / Returning to dock / Charging / Docked, offers a
// run mode select (Idle: pause, Clean: mow) and a "Return to dock" button.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DOCK_STATE, RUN_MODE } from './constants.js';
import { T as TEXT, pick } from './i18n.js';
import { safeId } from './navimow/model.js';

/** The feature keys (the last segment of the feature external ids). Forever. */
export const FEATURE = {
  STATE: 'state',
  RUN_MODE: 'run_mode',
  DOCK: 'dock',
  BATTERY: 'battery',
  ACTIVITY: 'activity',
  ERROR_CODE: 'error_code',
  ERROR: 'error',
  CONNECTED: 'connected',
  PROGRESS: 'progress',
  MOWED_AREA: 'mowed_area',
};

export const ids = {
  mower: (gladys, id) => gladys.externalId(`mower:${safeId(id)}`),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** The Navimow id part of a device external id ("ext:navimow:mower:<id>" -> "<id>"), or undefined. */
export function parseExternalId(externalId) {
  const match = /:mower:([A-Za-z0-9_.-]+)$/.exec(String(externalId ?? ''));
  return match ? match[1] : undefined;
}

/** The key of a feature external id ("ext:navimow:mower:<id>:dock" -> "dock"). */
export const featureKeyOf = (externalId) =>
  String(externalId ?? '')
    .split(':')
    .at(-1);

/** The activities that are an error by themselves (navimow-sdk maps isLifted to error). */
const ERROR_ACTIVITIES = new Set(['error', 'lifted']);

/** The mower reports an error: an error activity, or an error code or message. */
export const errorActive = (mower) =>
  ERROR_ACTIVITIES.has(mower.activity) ||
  Boolean(mower.error && (mower.error.code !== null || mower.error.message));

/** The error code feature: 0 none, the numeric code, -1 an error without a numeric code. */
export function errorCodeOf(mower) {
  if (!errorActive(mower)) {
    return 0;
  }
  return typeof mower.error?.code === 'number' ? mower.error.code : -1;
}

/** The error of a mower as { en, fr }: its message, its kind, its code, else its activity. */
export function errorLabel(mower) {
  if (!errorActive(mower)) {
    return TEXT.none;
  }
  const { code, message } = mower.error ?? {};
  if (message) {
    return { en: message, fr: message };
  }
  if (typeof code === 'string') {
    return TEXT.errorKind(code) ?? { en: code, fr: code };
  }
  if (typeof code === 'number') {
    return TEXT.errorCode(code);
  }
  return TEXT.activity(mower.activity);
}

/** The Gladys vacuum-cleaner state of a mower. */
export function dockStateOf(mower) {
  switch (mower.activity) {
    case 'error':
    case 'lifted':
      return DOCK_STATE.ERROR;
    case 'paused':
      return DOCK_STATE.PAUSED;
    case 'mowing':
    case 'mapping':
      return DOCK_STATE.RUNNING;
    case 'returning':
      return DOCK_STATE.RETURNING;
    case 'charging':
      return DOCK_STATE.CHARGING;
    case 'docked':
      return DOCK_STATE.DOCKED;
    default:
      return DOCK_STATE.STOPPED;
  }
}

/** The run mode select: CLEANING while the mower mows, IDLE otherwise. */
export const runModeOf = (mower) =>
  dockStateOf(mower) === DOCK_STATE.RUNNING ? RUN_MODE.CLEANING : RUN_MODE.IDLE;

const feature = (deviceId, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(deviceId, key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

export function buildMowerDevice(gladys, mower, language = 'fr') {
  const id = ids.mower(gladys, mower.id);
  const name = (key) => pick(TEXT.features[key], language);
  const text = (key) =>
    feature(id, key, name(key), C.TEXT, T.TEXT.TEXT, { min: 0, max: 0, keep_history: false });
  return {
    name: mower.name,
    external_id: id,
    features: [
      feature(id, FEATURE.STATE, name('state'), C.VACUUM_CLEANER, T.VACUUM_CLEANER.STATE, {
        max: 6,
      }),
      feature(id, FEATURE.RUN_MODE, name('run_mode'), C.VACUUM_CLEANER, T.VACUUM_CLEANER.RUN_MODE, {
        read_only: false,
        has_feedback: true,
        keep_history: false,
        // A mower has no mapping pass to offer: only Idle and Clean.
        supported_options: [
          { value: RUN_MODE.IDLE, label: TEXT.runOptions.pause, sort_order: 1 },
          { value: RUN_MODE.CLEANING, label: TEXT.runOptions.mow, sort_order: 2 },
        ],
      }),
      feature(id, FEATURE.DOCK, name('dock'), C.VACUUM_CLEANER, T.VACUUM_CLEANER.DOCK, {
        read_only: false,
        keep_history: false,
      }),
      feature(id, FEATURE.BATTERY, name('battery'), C.BATTERY, T.BATTERY.INTEGER, {
        unit: U.PERCENT,
        max: 100,
      }),
      text(FEATURE.ACTIVITY),
      feature(id, FEATURE.ERROR_CODE, name('error_code'), C.UNKNOWN, T.SENSOR.INTEGER, {
        min: -1,
        max: 100_000,
      }),
      text(FEATURE.ERROR),
      feature(id, FEATURE.CONNECTED, name('connected'), C.UNKNOWN, T.SENSOR.BINARY),
      feature(id, FEATURE.PROGRESS, name('progress'), C.UNKNOWN, T.SENSOR.INTEGER, {
        unit: U.PERCENT,
        max: 100,
      }),
      feature(id, FEATURE.MOWED_AREA, name('mowed_area'), C.SURFACE, T.SURFACE.DECIMAL, {
        unit: U.SQUARE_METER,
        max: 100_000,
      }),
    ],
    params: [
      { name: 'mower_id', value: mower.id },
      { name: 'model', value: mower.model ?? '' },
      { name: 'serial_number', value: mower.serial ?? '' },
      { name: 'firmware', value: mower.firmware ?? '' },
    ],
  };
}

const state = (deviceId, key, value) =>
  value === null || value === undefined
    ? []
    : [
        typeof value === 'string'
          ? { device_feature_external_id: ids.feature(deviceId, key), text: value }
          : { device_feature_external_id: ids.feature(deviceId, key), state: value },
      ];

/** The states of a mower device; texts in `language`. */
export function mowerStates(deviceId, mower, language = 'fr') {
  return [
    ...state(deviceId, FEATURE.STATE, dockStateOf(mower)),
    ...state(deviceId, FEATURE.RUN_MODE, runModeOf(mower)),
    ...state(deviceId, FEATURE.BATTERY, mower.battery),
    ...state(deviceId, FEATURE.ACTIVITY, pick(TEXT.activity(mower.activity), language)),
    ...state(deviceId, FEATURE.ERROR_CODE, errorCodeOf(mower)),
    ...state(deviceId, FEATURE.ERROR, pick(errorLabel(mower), language)),
    ...state(
      deviceId,
      FEATURE.CONNECTED,
      mower.connected === null || mower.connected === undefined ? null : mower.connected ? 1 : 0,
    ),
    ...state(deviceId, FEATURE.PROGRESS, mower.progress),
    ...state(deviceId, FEATURE.MOWED_AREA, mower.area),
  ];
}
