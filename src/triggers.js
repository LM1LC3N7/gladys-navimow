// -----------------------------------------------------------------------------
// Two consecutive readings of a mower -> scene events. Pure. Nothing fires on
// the first reading (no transition without a previous value), and a
// transition fires once: the next reading compares with the new state.
// -----------------------------------------------------------------------------

import { SCENE_TRIGGERS } from './constants.js';
import { errorActive, errorCodeOf, errorLabel } from './devices.js';

/** The activities that start a mowing session. */
const MOWING = new Set(['mowing', 'mapping']);
/** The activities a session goes through without ending (a pause, the way home, a lift). */
const IN_SESSION = new Set(['mowing', 'mapping', 'paused', 'returning', 'lifted', 'error']);
/** The activities that end a session. */
const ENDED = new Set(['docked', 'charging', 'idle']);
/** In the station. */
const STATION = new Set(['docked', 'charging']);
/** Coming back from these is the cloud seeing the mower again, not an arrival. */
const UNSEEN = new Set(['offline', 'unknown']);

/**
 * The reading of a mower: the plain mower, whether a mowing session is under
 * way, when it began (null when it began before the integration saw it) and
 * the last error seen (for the widget).
 */
export function nextReading(previous, mower, now) {
  const continues = Boolean(previous?.inSession) && IN_SESSION.has(mower.activity);
  const inSession = continues || MOWING.has(mower.activity);
  let sessionStartedAt = null;
  if (continues) {
    sessionStartedAt = previous.sessionStartedAt;
  } else if (inSession && previous) {
    sessionStartedAt = now;
  }
  const lastError = errorActive(mower)
    ? { code: errorCodeOf(mower), label: errorLabel(mower), at: now }
    : (previous?.lastError ?? null);
  return { ...mower, readAt: now, inSession, sessionStartedAt, lastError };
}

/** The progress of the session that just ended, or null when it reported none. */
function sessionProgress(previous, current) {
  if (current.progress === null || current.progress === undefined) {
    return null;
  }
  const start = previous.sessionStartedAt;
  // A progress older than the session belongs to the one before.
  if (start !== null && (current.progressAt ?? -Infinity) < start) {
    return null;
  }
  return current.progress;
}

function newError(previous, current) {
  if (!errorActive(previous)) {
    return true;
  }
  return (
    errorCodeOf(previous) !== errorCodeOf(current) ||
    errorLabel(previous).en !== errorLabel(current).en
  );
}

/**
 * The events of a mower between two readings. `deviceId` is the device
 * external id (the `mower` field of every trigger).
 */
export function mowerEvents(deviceId, previous, current) {
  const events = [];
  if (!previous) {
    return events;
  }
  const base = { mower: deviceId, mower_name: current.name };
  const battery = current.battery ?? null;

  if (errorActive(current) && newError(previous, current)) {
    const text = errorLabel(current);
    events.push({
      key: SCENE_TRIGGERS.ERROR,
      data: {
        ...base,
        code: errorCodeOf(current),
        error_en: text.en,
        error_fr: text.fr,
        activity: current.activity,
        battery,
      },
    });
  }

  if (current.activity !== previous.activity) {
    events.push({
      key: SCENE_TRIGGERS.ACTIVITY,
      data: {
        ...base,
        activity: current.activity,
        previous_activity: previous.activity,
        battery,
      },
    });
  }

  if (previous.inSession && ENDED.has(current.activity)) {
    const progress = sessionProgress(previous, current);
    const start = previous.sessionStartedAt;
    let outcome = 'unknown';
    if (progress !== null) {
      outcome = progress >= 100 ? 'complete' : 'interrupted';
    }
    events.push({
      key: SCENE_TRIGGERS.FINISHED,
      data: {
        ...base,
        outcome,
        activity: current.activity,
        minutes: start === null ? null : Math.max(0, Math.round((current.readAt - start) / 60_000)),
        progress,
        area: progress === null ? null : (current.area ?? null),
        battery,
        finished_at: new Date(current.readAt).toISOString(),
      },
    });
  }

  if (
    STATION.has(current.activity) &&
    !STATION.has(previous.activity) &&
    !UNSEEN.has(previous.activity)
  ) {
    events.push({
      key: SCENE_TRIGGERS.BACK,
      data: {
        ...base,
        previous_activity: previous.activity,
        battery,
        progress: current.progress ?? null,
      },
    });
  }
  return events;
}
