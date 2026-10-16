// -----------------------------------------------------------------------------
// The "mower" dashboard widget: one mower, its battery and mowing progress,
// its activity, error, connection and live link, and four buttons (start,
// pause, resume, back to the station). Pure.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DOCK_STATE, WIDGET_ACTIONS } from './constants.js';
import { dockStateOf, errorActive, errorLabel } from './devices.js';
import { T, pick } from './i18n.js';

const ACTIVITY_COLOR = {
  [DOCK_STATE.RUNNING]: WIDGET_COLORS.SUCCESS,
  [DOCK_STATE.RETURNING]: WIDGET_COLORS.INFO,
  [DOCK_STATE.CHARGING]: WIDGET_COLORS.INFO,
  [DOCK_STATE.DOCKED]: WIDGET_COLORS.NEUTRAL,
  [DOCK_STATE.PAUSED]: WIDGET_COLORS.WARNING,
  [DOCK_STATE.STOPPED]: WIDGET_COLORS.WARNING,
  [DOCK_STATE.ERROR]: WIDGET_COLORS.DANGER,
};

const cut = (text, max) => String(text).slice(0, max);

/** "14:05" (UTC) of an instant: the widget has no time zone of its own. */
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

function batteryTile(reading) {
  const tile = {
    type: 'value',
    label: T.widget.battery,
    icon: reading.activity === 'charging' ? 'battery-charging' : 'battery',
  };
  if (reading.battery === null || reading.battery === undefined) {
    return { ...tile, value: '—', color: WIDGET_COLORS.NEUTRAL };
  }
  let color = WIDGET_COLORS.SUCCESS;
  if (reading.battery < 20) {
    color = WIDGET_COLORS.DANGER;
  } else if (reading.battery < 50) {
    color = WIDGET_COLORS.WARNING;
  }
  return { ...tile, value: reading.battery, unit: '%', color };
}

function progressTile(reading) {
  const tile = { type: 'value', label: T.widget.progress, icon: 'trending-up' };
  if (reading.progress === null || reading.progress === undefined) {
    return { ...tile, value: '—', color: WIDGET_COLORS.NEUTRAL };
  }
  return {
    ...tile,
    value: reading.progress,
    unit: '%',
    color: reading.progress >= 100 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.PRIMARY,
  };
}

function errorRow(reading, language) {
  if (errorActive(reading)) {
    return {
      label: T.widget.error,
      value: cut(pick(errorLabel(reading), language), 40),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (reading.lastError) {
    const text = pick(reading.lastError.label, language);
    return {
      label: T.widget.lastError,
      value: cut(`${text} · ${hhmm(reading.lastError.at)} UTC`, 40),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label: T.widget.error,
    value: pick(T.widget.noError, language),
    icon: 'check-circle',
    color: WIDGET_COLORS.NEUTRAL,
  };
}

/** `reading` is the app's reading of the mower (triggers.js nextReading). */
export function mowerWidget({ reading, live = false, language = 'fr' }) {
  if (!reading) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', text: T.widget.noMower, variant: 'body' }],
    };
  }
  const dock = dockStateOf(reading);
  const rows = [
    {
      label: T.widget.activity,
      value: cut(pick(T.activity(reading.activity), language), 40),
      icon: 'activity',
      color: ACTIVITY_COLOR[dock],
    },
    errorRow(reading, language),
    reading.connected === false
      ? {
          label: T.widget.connection,
          value: pick(T.widget.disconnected, language),
          icon: 'wifi-off',
          color: WIDGET_COLORS.DANGER,
        }
      : {
          label: T.widget.connection,
          value: pick(T.widget.connected, language),
          icon: 'wifi',
          color: WIDGET_COLORS.SUCCESS,
        },
    {
      label: T.widget.live,
      value: pick(live ? T.widget.liveOn : T.widget.liveOff, language),
      icon: 'radio',
      color: live ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    },
  ];
  const params = { mower: reading.id };
  const button = (label, icon, style, key) => ({
    type: 'button',
    label,
    icon,
    style,
    action: { key, params },
  });
  return {
    ttl_seconds: dock === DOCK_STATE.RUNNING || dock === DOCK_STATE.RETURNING ? 60 : 300,
    components: [
      { type: 'text', text: cut(reading.name, 40), variant: 'heading' },
      batteryTile(reading),
      progressTile(reading),
      { type: 'status', items: rows },
      button(T.widget.start, 'play', 'primary', WIDGET_ACTIONS.START),
      button(T.widget.pause, 'pause', 'secondary', WIDGET_ACTIONS.PAUSE),
      button(T.widget.resume, 'skip-forward', 'secondary', WIDGET_ACTIONS.RESUME),
      button(T.widget.dock, 'home', 'secondary', WIDGET_ACTIONS.DOCK),
    ],
  };
}
