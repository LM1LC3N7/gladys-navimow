// -----------------------------------------------------------------------------
// Navimow JSON -> plain values. Pure.
//
// Field names come from Segway's navimow-sdk 0.1.2 (models.py, api.py: the
// parser of the REST and MQTT payloads, read as documentation) and from
// ioBroker.navimow 1.1.2 (MIT, TA2k: the states it reads, the location
// readings it recorded from a real mower). See THIRD_PARTY_NOTICES.md.
// BUILT BLIND: no Navimow account was available, every Navimow name lives in
// src/navimow/ so that a user report fixes one place.
//
//   GET authList -> { code: 1, data: { payload: { devices: [{ id, name, model,
//     firmware_version, serial_number, mac_address, online, productKey,
//     deviceName, iotId }] } } }
//   POST getVehicleStatus -> { code: 1, data: { payload: { devices: [{ id,
//     vehicleState, capacityRemaining: [{ rawValue, unit: 'PERCENTAGE' }],
//     descriptiveCapacityRemaining, error_code, error_message, ... }] } } }
//   MQTT /downlink/vehicle/<id>/realtimeDate/state -> { state, battery,
//     error, timestamp, ... } (the field is `state` there, `vehicleState`
//     over REST: the same values)
//   MQTT .../location -> [{ type: 2, time, mowingPercentage, subtotalArea:
//     "4.21", mowingWeekArea, ... } | { type: 1, postureX, postureY, ... }]
// -----------------------------------------------------------------------------

/** A finite number, also from a numeric string; null otherwise (never 0 for nothing). */
export function num(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const text = (value) =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : null;

/** The vehicle states the cloud sends (navimow-sdk, ioBroker.navimow) -> our activities. */
const RAW_ACTIVITY = {
  isrunning: 'mowing',
  ismapping: 'mapping',
  ispaused: 'paused',
  isdocking: 'returning',
  isdocked: 'docked',
  ischarging: 'charging',
  isidle: 'idle',
  // sic: navimow-sdk maps the typo too
  isidel: 'idle',
  islifted: 'lifted',
  error: 'error',
  insoftwareupdate: 'updating',
  'self-checking': 'self_check',
  offline: 'offline',
  // the canonical states of navimow-sdk, should a payload carry one
  mowing: 'mowing',
  paused: 'paused',
  returning: 'returning',
  docked: 'docked',
  charging: 'charging',
  idle: 'idle',
  unknown: 'unknown',
};

/** The result statuses of a Google smart home QUERY answer: not a vehicle state. */
const RESULT_STATUSES = new Set(['success', 'pending', 'exceptions']);

/**
 * The vehicle state of a payload: `state` (MQTT), `vehicleState` (REST), else
 * `status` (navimow-sdk reads it first), unless it is a query result status.
 */
export function rawStateOf(payload) {
  for (const key of ['state', 'vehicleState', 'status']) {
    const value = payload?.[key];
    if (
      typeof value === 'string' &&
      value.trim() &&
      !RESULT_STATUSES.has(value.trim().toLowerCase())
    ) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Our activity for a vehicle state. A docked mower that says it charges
 * (`charging`: the Google EnergyStorage `isCharging` flag) is "charging".
 */
export function activityOf(rawState, { charging = null } = {}) {
  if (rawState === null || rawState === undefined) {
    return 'unknown';
  }
  const activity = RAW_ACTIVITY[String(rawState).trim().toLowerCase()] ?? 'unknown';
  if (activity === 'docked' && charging === true) {
    return 'charging';
  }
  return activity;
}

/**
 * The battery level (0 to 100): `battery` (MQTT), else the PERCENTAGE entry
 * of `capacityRemaining` (REST), else its first entry (navimow-sdk,
 * ioBroker.navimow). null when the payload carries none.
 */
export function batteryOf(payload) {
  let value = num(payload?.battery);
  const capacity = payload?.capacityRemaining;
  if (value === null && Array.isArray(capacity)) {
    const percent = capacity.find(
      (item) => item && String(item.unit ?? '').toUpperCase() === 'PERCENTAGE',
    );
    value = num((percent ?? capacity[0])?.rawValue);
  }
  return value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
}

/** The charging flag when the payload has one (`isCharging`), else null. */
export function chargingOf(payload) {
  const value = payload?.isCharging ?? payload?.charging;
  return typeof value === 'boolean' ? value : null;
}

/** The online flag when the payload has one, else null. */
export function onlineOf(payload) {
  return typeof payload?.online === 'boolean' ? payload.online : null;
}

const NO_ERROR = new Set(['', 'none', '0', 'null', 'ok', 'normal']);

/** Is an error code "no error"? */
const isNone = (code) =>
  code === null || code === undefined || NO_ERROR.has(String(code).trim().toLowerCase());

/**
 * The error of a payload: `error` ({ code, message } or a bare code),
 * `error_code` / `errorCode` and `error_message` / `errorMessage` / `errorMsg`.
 * Returns { code, message } (code: a number, a string such as "stuck", or
 * null), null when it reports none, undefined when it says nothing about it.
 */
export function errorOf(payload) {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const nested = payload.error;
  const hasNested = 'error' in payload;
  const hasFlat = ['error_code', 'errorCode', 'error_message', 'errorMessage', 'errorMsg'].some(
    (key) => key in payload,
  );
  if (!hasNested && !hasFlat) {
    return undefined;
  }
  let code;
  let message;
  if (nested && typeof nested === 'object') {
    code = nested.code ?? nested.errorCode ?? nested.error_code;
    message = text(nested.message ?? nested.msg ?? nested.errorMsg ?? nested.desc);
  } else if (nested !== null && nested !== undefined && nested !== false) {
    code = nested;
  }
  code ??= payload.error_code ?? payload.errorCode;
  message ??= text(payload.error_message ?? payload.errorMessage ?? payload.errorMsg);
  if (isNone(code) && !message) {
    return null;
  }
  const numeric = num(code);
  return {
    code: isNone(code) ? null : numeric !== null ? numeric : String(code).trim().toLowerCase(),
    message: message ?? null,
  };
}

/** The name of a device: a string, or Google's `{ name }`, else its device name, else its id. */
function nameOf(device) {
  const name = device.name;
  if (typeof name === 'string' && name.trim()) {
    return name.trim();
  }
  if (name && typeof name === 'object' && typeof name.name === 'string' && name.name.trim()) {
    return name.name.trim();
  }
  return text(device.deviceName ?? device.device_name) ?? `Navimow ${String(device.id).slice(-6)}`;
}

/** One entry of authList -> the plain mower identity, or null without an id. */
export function deviceOf(device) {
  if (!device || typeof device !== 'object' || text(device.id) === null) {
    return null;
  }
  const info = device.deviceInfo && typeof device.deviceInfo === 'object' ? device.deviceInfo : {};
  return {
    id: text(device.id),
    name: nameOf(device),
    model: text(device.model ?? info.model ?? device.productKey ?? device.product_key),
    firmware: text(
      device.firmware_version ?? device.firmwareVersion ?? info.swVersion ?? device.swVersion,
    ),
    serial: text(device.serial_number ?? device.serialNumber ?? device.sn),
    online: onlineOf(device),
  };
}

/** The devices of an authList answer (`data.payload.devices`). */
export function devicesOf(data) {
  const list = data?.payload?.devices ?? data?.devices;
  return Array.isArray(list) ? list.map(deviceOf).filter(Boolean) : [];
}

/**
 * One entry of getVehicleStatus, or one MQTT state message -> the plain
 * reading: { rawState, battery, charging, online, error } (each null or
 * undefined when the payload does not say).
 */
export function readingOf(payload) {
  return {
    rawState: rawStateOf(payload),
    battery: batteryOf(payload),
    charging: chargingOf(payload),
    online: onlineOf(payload),
    error: errorOf(payload),
  };
}

/** The status entries of a getVehicleStatus answer, keyed by device id. */
export function statusesOf(data) {
  const list = data?.payload?.devices ?? data?.devices;
  const result = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const id = text(item?.id ?? item?.device_id);
    if (id !== null) {
      result.set(id, readingOf(item));
    }
  }
  return result;
}

/**
 * The topic of a message -> { deviceId, channel }, or null for another
 * topic. /downlink/vehicle/<id>/realtimeDate/<channel> (the leading slash
 * and the "realtimeDate" spelling are the cloud's).
 */
export function parseTopic(topic) {
  const parts = String(topic ?? '')
    .split('/')
    .filter((part) => part !== '');
  if (parts.length < 4 || parts[0] !== 'downlink' || parts[1] !== 'vehicle') {
    return null;
  }
  return { deviceId: parts[2], channel: parts[parts.length - 1] };
}

/** The four topics of a mower. */
export const topicsOf = (deviceId, channels) =>
  channels.map((channel) => `/downlink/vehicle/${deviceId}/realtimeDate/${channel}`);

/**
 * The mowing progress of a location message: the newest `type: 2` reading
 * the mower sent, { percentage, area, weekArea, time }, or null. Readings
 * the broker delivers late are dropped: `seen` maps each reading type to the
 * newest `time` seen (updated here), and a reading older than that says
 * nothing about now (ioBroker.navimow: a progress arrived 1 h 45 late, after
 * the session ended). A reading dated more than `aheadMax` ms in the future
 * does not move the mark (a wrong clock would lock the real ones out).
 */
export function progressOf(payload, seen, now, aheadMax) {
  const points = Array.isArray(payload) ? payload : [payload];
  let progress = null;
  for (const point of points) {
    if (!point || typeof point !== 'object') {
      continue;
    }
    const time = num(point.time);
    if (time !== null && point.type !== undefined && point.type !== null) {
      const newest = seen.get(point.type);
      if (newest !== undefined && time < newest) {
        continue;
      }
      if (time - now < aheadMax) {
        seen.set(point.type, time);
      }
    }
    const percentage = num(point.mowingPercentage);
    const area = num(point.subtotalArea);
    if (Number(point.type) !== 2 && percentage === null) {
      continue;
    }
    if (percentage === null && area === null) {
      continue;
    }
    progress = {
      percentage: percentage === null ? null : Math.max(0, Math.min(100, Math.round(percentage))),
      area: area === null ? null : Math.max(0, Math.round(area * 100) / 100),
      weekArea: num(point.mowingWeekArea),
      time,
    };
  }
  return progress;
}

/** A Navimow id as a piece of a Gladys external id: [A-Za-z0-9_.-] only. */
export const safeId = (id) => String(id).replace(/[^A-Za-z0-9_.-]/g, '_');
