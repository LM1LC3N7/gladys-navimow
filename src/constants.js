// -----------------------------------------------------------------------------
// Constants of the Segway Navimow integration.
//
// The Navimow names (URLs, paths, codes, commands, topics) come from Segway's
// own navimow-sdk 0.1.2 and NavimowHA 1.1.1 (read as documentation) and from
// ioBroker.navimow 1.1.2 (MIT, TA2k), which drives the same API from Node; the
// error answers were probed without an account on 2026-10-16 (TODO.md).
// -----------------------------------------------------------------------------

/** The Navimow open API (the only region Segway's integrations know: Frankfurt). */
export const API_URL = 'https://navimow-fra.ninebot.com';

export const PATHS = {
  TOKEN: '/openapi/oauth/getAccessToken',
  DEVICES: '/openapi/smarthome/authList',
  STATUS: '/openapi/smarthome/getVehicleStatus',
  COMMANDS: '/openapi/smarthome/sendCommands',
  MQTT_INFO: '/openapi/mqtt/userInfo/get/v2',
};

/**
 * The OAuth2 sign-in page of Navimow: it reads `redirect_uri` and `state`
 * from its address and, once the user is signed in, sends the browser to
 * `<redirect_uri>?code=<code>&state=<state>` (read in its script on
 * 2026-10-16). The client is the one Segway publishes in NavimowHA (and
 * ioBroker.navimow uses): Segway offers no developer registration.
 */
export const OAUTH = {
  AUTHORIZE_URL: 'https://navimow-h5-fra.willand.com/smartHome/login',
  CHANNEL: 'homeassistant',
  CLIENT_ID: 'homeassistant',
  CLIENT_SECRET: '57056e15-722e-42be-bbaa-b0cbfb208a52',
  /** The redirect of the manual sign-in: a page that does not load, its address holds the code. */
  MANUAL_REDIRECT_URI: 'http://localhost:1/callback',
};

/** The sign-in link of the manual fallback (also in the manifest, test/manifest.test.js). */
export const MANUAL_SIGN_IN_URL =
  `${OAUTH.AUTHORIZE_URL}?channel=${OAUTH.CHANNEL}&client_id=${OAUTH.CLIENT_ID}` +
  `&response_type=code&redirect_uri=${encodeURIComponent(OAUTH.MANUAL_REDIRECT_URI)}`;

/** The `code` of the API answers (HTTP 200 every time, probed 2026-10-16). */
export const API_CODES = {
  OK: 1,
  TOKEN_EMPTY: 4003,
  TOKEN_ILLEGAL: 4005,
};

/** The commands (Google smart home traits, as navimow-sdk and ioBroker.navimow send them). */
export const COMMANDS = {
  start: { command: 'action.devices.commands.StartStop', params: { on: true } },
  pause: { command: 'action.devices.commands.PauseUnpause', params: { on: false } },
  resume: { command: 'action.devices.commands.PauseUnpause', params: { on: true } },
  dock: { command: 'action.devices.commands.Dock' },
};

/** A command result the API reports as an error but that changes nothing (navimow-sdk). */
export const ALREADY_IN_STATE = 'alreadyInState';

/** The MQTT channels read, under /downlink/vehicle/<id>/realtimeDate/<channel>. */
export const CHANNELS = ['state', 'event', 'attributes', 'location'];

export const USER_AGENT = 'gladys-navimow/0.1 (+https://github.com/LM1LC3N7/gladys-navimow)';

// --- Pacing ------------------------------------------------------------------------

export const HTTP_TIMEOUT = 15_000;
/** The OAuth2 callback is acked within 5 s by Gladys: the code exchange must fit. */
export const CALLBACK_TIMEOUT = 4_000;
/** Renew the access token that long before it expires. */
export const TOKEN_MARGIN = 5 * 60_000;
/** A failed renewal (network, gateway) is tried again after these delays (ioBroker.navimow). */
export const TOKEN_RETRY = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
/** An anti-CSRF state of the Connect button lives that long. */
export const STATE_TTL = 30 * 60_000;

/** The loop wakes up this often; most ticks make no call. */
export const TICK_INTERVAL = 30_000;
/** REST status read while the live link is down (or the configured one if shorter). */
export const FALLBACK_POLL = 2 * 60_000;
/** The device list is read again this often (a renamed or new mower). */
export const DEVICE_LIST_INTERVAL = 12 * 60 * 60_000;
/** An account without a mower is looked at again this often. */
export const EMPTY_LIST_INTERVAL = 30 * 60_000;
/** A command is read back that long after (the cloud status runs behind). */
export const COMMAND_SETTLE = 10_000;
/**
 * The live state channel wins over a REST status for that long: the REST
 * status comes from a cache one to two minutes behind (ioBroker.navimow saw
 * it answer "isDocked" for a mower out mowing).
 */
export const STATE_TRUST = 3 * 60_000;
/** A location reading dated further ahead than this does not become the newest one seen. */
export const LOCATION_AHEAD_MAX = 5 * 60_000;

/** MQTT keepalive: 60 s keeps the link from being reaped while the mower stands (ioBroker.navimow). */
export const MQTT_KEEPALIVE = 60;
export const MQTT_CONNECT_TIMEOUT = 30_000;
/** Reconnection delays of the live link (ours: mqtt.js reconnection is off). */
export const MQTT_RECONNECT = [5_000, 10_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000];
/** A connection that never came up fetches the broker credentials again at most that often. */
export const MQTT_CREDENTIALS_MIN_AGE = 10 * 60_000;
/** The live link is called "connecting" (not "down") that long after a start. */
export const LIVE_GRACE = 2 * 60_000;

// --- Gladys ------------------------------------------------------------------------

/**
 * VACUUM_CLEANER_STATE of Gladys (server/utils/constants.js); the SDK exports
 * the category and types but not this enum. The device card labels them
 * Stopped, Running, Paused, Error, Returning to dock, Charging, Docked.
 */
export const DOCK_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING: 4,
  CHARGING: 5,
  DOCKED: 6,
};
/** VACUUM_CLEANER_MODE of Gladys: the run mode select (IDLE pauses, CLEANING mows). */
export const RUN_MODE = { IDLE: 0, CLEANING: 1 };

export const LANGUAGES = ['fr', 'en'];

// --- Manifest keys (forever: stored in user scenes and dashboards) --------------------

/** The oauth2 field of the config_schema. */
export const ACCOUNT_KEY = 'account';
/** Where the tokens are kept (a config key outside the config_schema). */
export const TOKEN_KEY = 'navimow_token';

export const ACTIONS = { TEST: 'test_connection', SIGN_IN: 'sign_in_with_url' };
export const SCENE_ACTIONS = {
  START: 'start',
  PAUSE: 'pause',
  RESUME: 'resume',
  DOCK: 'dock',
};
export const SCENE_TRIGGERS = {
  ERROR: 'mower_error',
  ACTIVITY: 'activity_changed',
  FINISHED: 'mowing_finished',
  BACK: 'back_to_station',
};
export const WIDGETS = { MOWER: 'mower' };

/** The actions of the buttons of the "mower" widget (forever: cached contents). */
export const WIDGET_ACTIONS = SCENE_ACTIONS;

/** The activities of a mower: the `activity` field of activity_changed. */
export const ACTIVITIES = [
  'mowing',
  'mapping',
  'paused',
  'returning',
  'docked',
  'charging',
  'idle',
  'lifted',
  'error',
  'updating',
  'self_check',
  'offline',
  'unknown',
];

/** The `outcome` of mowing_finished. */
export const OUTCOMES = ['complete', 'interrupted', 'unknown'];
