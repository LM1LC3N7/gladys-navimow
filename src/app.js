// -----------------------------------------------------------------------------
// The integration itself: the Navimow sign-in (Connect button or pasted
// address), discovery, the REST loop, the live link, the commands (run mode,
// dock), the scene triggers and actions, the "mower" widget and the test
// button. index.js only wires the SDK handlers to it.
//
// Pace: the device list and the status of every mower (one call for all) at
// start; then the live link (MQTT over WSS) carries the state while the
// mower works, and the status is read again every `poll_minutes` (5 by
// default), every 2 minutes while the live link is down, and 10 seconds
// after a command. The device list is read again every 12 hours and on a
// Discovery scan. A loop tick every 30 seconds decides; most ticks make no
// call. The token is renewed 5 minutes before it expires.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  ACCOUNT_KEY,
  CALLBACK_TIMEOUT,
  COMMAND_SETTLE,
  DEVICE_LIST_INTERVAL,
  EMPTY_LIST_INTERVAL,
  FALLBACK_POLL,
  LIVE_GRACE,
  LOCATION_AHEAD_MAX,
  OAUTH,
  RUN_MODE,
  STATE_TRUST,
  TICK_INTERVAL,
  TOKEN_KEY,
  WIDGETS,
  WIDGET_ACTIONS,
} from './constants.js';
import {
  FEATURE,
  buildMowerDevice,
  featureKeyOf,
  ids,
  mowerStates,
  parseExternalId,
} from './devices.js';
import { T } from './i18n.js';
import {
  NavimowAuth,
  NavimowError,
  codeFromInput,
  reasonOf,
  tokenToStore,
} from './navimow/auth.js';
import { NavimowClient } from './navimow/client.js';
import { LiveLink } from './navimow/live.js';
import { activityOf, progressOf, readingOf, safeId } from './navimow/model.js';
import { mowerEvents, nextReading } from './triggers.js';
import { mowerWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

/** The activities that are an error by themselves: an error reported with them stays. */
const ERROR_ACTIVITIES = new Set(['error', 'lifted']);

/** A sign-in problem nothing but a new sign-in can fix. */
const isFinal = (err) => ['refused', 'token', 'no_token'].includes(err?.code);

export class NavimowApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'navimow' }),
    now = Date.now,
    timers = defaultTimers,
    mqttConnect,
    apiUrl,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    this.auth = new NavimowAuth({
      ...(apiUrl ? { apiUrl } : {}),
      now,
      onToken: (token, reason) => this.tokenChanged(token, reason),
    });
    this.client = new NavimowClient({ auth: this.auth, ...(apiUrl ? { apiUrl } : {}) });
    this.live = new LiveLink({
      client: this.client,
      auth: this.auth,
      logger,
      timers,
      now,
      ...(mqttConnect ? { connect: mqttConnect } : {}),
    });
    this.live.on('message', (message) =>
      this.handleMessage(message).catch((err) =>
        this.logger.warn(`Live message failed: ${err.message}`),
      ),
    );
    this.live.on('status', (connected) => this.liveChanged(connected));
    this.generation = 0;
    this.tickTimer = undefined;
    this.ticking = undefined;
    this.settleTimer = undefined;
    this.lastStatus = undefined;
    this.queue = Promise.resolve();
    this.reset();
  }

  reset() {
    /** mower id -> what is known of it (identity, last state, battery, progress...) */
    this.records = new Map();
    /** mower id -> the last reading (the triggers compare with it) */
    this.readings = new Map();
    /** mower id -> location reading type -> newest time seen */
    this.locationSeen = new Map();
    this.lastListAt = -Infinity;
    this.lastStatusAt = -Infinity;
    this.healthy = false;
    this.fatal = undefined;
    this.startedAt = this.now();
    /** The live link connected at least once since the start. */
    this.liveSeen = false;
  }

  // --- Lifecycle -------------------------------------------------------------------

  /** (Re)start with a configuration (Gladys connected, or the user saved it). */
  async start(raw = {}) {
    this.stop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.auth.load(this.config.token);
    const known = new Map(this.records);
    this.reset();
    // A restart keeps what it knew: the mowers stay commandable meanwhile.
    for (const [id, record] of known) {
      this.records.set(id, record);
    }
    if (!this.auth.signedIn) {
      await this.setStatus(false, T.notSignedIn);
      return;
    }
    if (this.auth.refused) {
      this.fatal = new NavimowError('refused', 'sign in again');
      await this.setStatus(false, T.refused);
      return;
    }
    try {
      await this.readList();
      await this.readStatuses();
    } catch (err) {
      await this.reportError(err);
      if (this.fatal) {
        return;
      }
    }
    if (generation !== this.generation) {
      return;
    }
    this.live.start([...this.records.keys()]);
    this.tickTimer = this.timers.setInterval(
      () => this.tick().catch((err) => this.reportError(err)),
      TICK_INTERVAL,
    );
    if (this.healthy) {
      await this.reportOk();
    }
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    this.timers.clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    this.live.stop();
  }

  shutdown() {
    this.stop();
  }

  /** Only a new sign-in can help: nothing more until then. */
  halt(err) {
    this.fatal = err;
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    this.live.stop();
  }

  /** Restart in the background (after a sign-in: the callback is acked within 5 s). */
  restart() {
    this.start(this.gladys.config ?? {}).catch((err) =>
      this.logger.error(`Restart failed: ${err.message}`),
    );
  }

  /** One read or live message at a time: a REST answer never overwrites a newer message midway. */
  exclusive(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async reportOk() {
    if (this.records.size === 0) {
      await this.setStatus(true, T.noMower);
      return;
    }
    let live = 'on';
    if (!this.live.connected) {
      // Right after a start the live link is still connecting: not "down" yet.
      live = this.liveSeen || this.now() - this.startedAt > LIVE_GRACE ? 'down' : 'connecting';
    }
    await this.setStatus(
      true,
      T.ok({ mowers: this.records.size, live, pollMinutes: this.config.pollMinutes }),
    );
  }

  async reportError(err) {
    this.healthy = false;
    this.logger.warn(`Navimow: ${reasonOf(err)}`);
    if (err?.code === 'no_token') {
      this.halt(err);
      await this.setStatus(false, T.notSignedIn);
    } else if (isFinal(err)) {
      this.halt(err);
      await this.setStatus(false, T.refused);
    } else {
      await this.setStatus(false, T.unreachable(reasonOf(err)));
    }
  }

  // --- Tokens ----------------------------------------------------------------------------

  /** A new token: store it in Gladys; after a renewal, reconnect the live link with it. */
  async tokenChanged(token, reason) {
    try {
      await this.gladys.setConfig({ [TOKEN_KEY]: tokenToStore(token) });
    } catch (err) {
      this.logger.warn(`Could not store the Navimow token: ${err.message}`);
    }
    if (reason === 'renew') {
      this.live.renewed();
    }
  }

  /**
   * Renew the token ahead of its expiry (src/navimow/auth.js paces the
   * retries). False when it expired and could not be renewed: nothing can be
   * read until it is.
   */
  async renewToken() {
    await this.auth.renewIfDue();
    if (this.auth.expired) {
      this.healthy = false;
      const reason = reasonOf(this.auth.lastFailure);
      this.logger.warn(`Token renewal failed (${reason})`);
      await this.setStatus(
        false,
        T.renewalRetry(reason, Math.max(0, this.auth.retryAt - this.now())),
      );
      return false;
    }
    return true;
  }

  // --- Reading -----------------------------------------------------------------------

  /** The device list: new mowers, removed ones, names. */
  readList() {
    return this.exclusive(async () => {
      this.lastListAt = this.now();
      const devices = await this.client.devices();
      this.healthy = true;
      const before = [...this.records.keys()].sort().join('|');
      const seen = new Set();
      for (const device of devices) {
        seen.add(device.id);
        const record = this.records.get(device.id) ?? { ...this.emptyRecord(), id: device.id };
        Object.assign(record, {
          name: device.name,
          model: device.model,
          firmware: device.firmware,
          serial: device.serial,
        });
        if (device.online !== null) {
          record.connected = device.online;
        }
        this.records.set(device.id, record);
      }
      for (const id of [...this.records.keys()]) {
        if (!seen.has(id)) {
          this.records.delete(id);
          this.readings.delete(id);
          this.locationSeen.delete(id);
        }
      }
      const changed = [...seen].sort().join('|') !== before;
      await this.publishDevices();
      if (changed && this.live.running) {
        this.live.start([...seen]);
      }
    });
  }

  emptyRecord() {
    return {
      name: null,
      model: null,
      firmware: null,
      serial: null,
      rawState: null,
      charging: null,
      battery: null,
      error: null,
      connected: null,
      liveStateAt: -Infinity,
      liveBatteryAt: -Infinity,
      progress: null,
      area: null,
      progressAt: null,
    };
  }

  /** Merge a state reading (REST status or live message) into a record. */
  mergeState(record, reading) {
    if (reading.rawState !== null) {
      record.rawState = reading.rawState;
      if (reading.error !== undefined) {
        record.error = reading.error;
      } else if (!ERROR_ACTIVITIES.has(activityOf(reading.rawState))) {
        // A new state that says nothing of an error: the error is over.
        record.error = null;
      }
    } else if (reading.error !== undefined) {
      record.error = reading.error;
    }
    if (reading.charging !== null) {
      record.charging = reading.charging;
    }
  }

  /** The status of every mower, in one call. */
  readStatuses() {
    return this.exclusive(async () => {
      this.lastStatusAt = this.now();
      if (this.records.size === 0) {
        return;
      }
      const statuses = await this.client.statuses([...this.records.keys()]);
      this.healthy = true;
      const now = this.now();
      for (const [id, reading] of statuses) {
        const record = this.records.get(id);
        if (!record) {
          continue;
        }
        // The REST status runs a minute or two behind: a live state that
        // spoke recently keeps the state (and its error) to itself.
        if (now - record.liveStateAt >= STATE_TRUST) {
          this.mergeState(record, reading);
        }
        if (reading.battery !== null && now - record.liveBatteryAt >= STATE_TRUST) {
          record.battery = reading.battery;
        }
        if (reading.online !== null) {
          record.connected = reading.online;
        }
      }
      await this.publish([...statuses.keys()].filter((id) => this.records.has(id)));
    });
  }

  tick() {
    if (!this.ticking) {
      this.ticking = this.doTick().finally(() => {
        this.ticking = undefined;
      });
    }
    return this.ticking;
  }

  async doTick() {
    if (this.fatal || !(await this.renewToken())) {
      return;
    }
    const now = this.now();
    // No mower known: the list failed (retried at the fallback pace) or the
    // account is empty (looked at again every 30 minutes).
    let listInterval = DEVICE_LIST_INTERVAL;
    if (this.records.size === 0) {
      listInterval = this.healthy ? EMPTY_LIST_INTERVAL : FALLBACK_POLL;
    }
    if (now - this.lastListAt >= listInterval) {
      await this.readList();
    }
    const configured = this.config.pollMinutes * 60_000;
    // A failed read is retried at the fallback pace, live link or not.
    const interval =
      this.live.connected && this.healthy ? configured : Math.min(configured, FALLBACK_POLL);
    if (now - this.lastStatusAt >= interval) {
      await this.readStatuses();
    }
    if (this.healthy) {
      // Also reports a live link that dropped since the last tick.
      await this.reportOk();
    }
  }

  // --- Live link ---------------------------------------------------------------------

  liveChanged(connected) {
    if (connected) {
      this.liveSeen = true;
    }
    if (this.healthy && !this.fatal) {
      this.reportOk().catch(() => {});
    }
  }

  /** A message of the live link: { deviceId, channel, payload }. */
  handleMessage({ deviceId, channel, payload }) {
    if (channel === 'event' || channel === 'attributes') {
      // Not used yet (their content is undocumented): logged to learn it.
      this.logger.debug(
        `Mower ${channel} on ${safeId(deviceId)}: ${JSON.stringify(payload).slice(0, 500)}`,
      );
      return Promise.resolve();
    }
    if (channel !== 'state' && channel !== 'location') {
      return Promise.resolve();
    }
    return this.exclusive(async () => {
      const record = this.records.get(deviceId);
      if (!record) {
        return;
      }
      const now = this.now();
      if (channel === 'location') {
        let seen = this.locationSeen.get(deviceId);
        if (!seen) {
          seen = new Map();
          this.locationSeen.set(deviceId, seen);
        }
        const progress = progressOf(payload, seen, now, LOCATION_AHEAD_MAX);
        if (!progress) {
          return;
        }
        const before = [record.progress, record.area].join('|');
        if (progress.percentage !== null) {
          record.progress = progress.percentage;
        }
        if (progress.area !== null) {
          record.area = progress.area;
        }
        record.progressAt = now;
        if ([record.progress, record.area].join('|') !== before) {
          await this.publish([deviceId]);
        }
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return;
      }
      const reading = readingOf(payload);
      if (reading.rawState !== null) {
        record.liveStateAt = now;
      }
      this.mergeState(record, reading);
      if (reading.battery !== null) {
        record.battery = reading.battery;
        record.liveBatteryAt = now;
      }
      // A message from the mower is the proof it is online.
      record.connected = reading.online ?? true;
      await this.publish([deviceId]);
    });
  }

  // --- Publishing ----------------------------------------------------------------------

  /** The plain mower of a record (what devices.js, triggers.js and widget.js read). */
  mowerOf(id) {
    const record = this.records.get(id);
    const activity = activityOf(record.rawState, { charging: record.charging });
    return {
      id,
      name: record.name ?? `Navimow ${safeId(id).slice(-6)}`,
      model: record.model,
      firmware: record.firmware,
      serial: record.serial,
      rawState: record.rawState,
      activity,
      battery: record.battery,
      error: record.error,
      connected: activity === 'offline' ? false : record.connected,
      progress: record.progress,
      area: record.area,
      progressAt: record.progressAt,
    };
  }

  /** Readings, states of the created devices, scene events, widget nudge. No API call. */
  async publish(mowerIds) {
    const now = this.now();
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const states = [];
    const events = [];
    for (const id of mowerIds) {
      if (!this.records.has(id)) {
        continue;
      }
      const mower = this.mowerOf(id);
      const previous = this.readings.get(id);
      const reading = nextReading(previous, mower, now);
      this.readings.set(id, reading);
      const deviceId = ids.mower(this.gladys, id);
      if (created.has(deviceId)) {
        states.push(...mowerStates(deviceId, reading, this.config.language));
      }
      events.push(...mowerEvents(deviceId, previous, reading));
    }
    let changed = 0;
    if (states.length > 0) {
      try {
        const result = await this.gladys.publishChangedStates(states, { heartbeat: 60 * 60_000 });
        changed = result?.count ?? 0;
      } catch (err) {
        this.logger.warn(`States failed: ${err.message}`);
      }
    }
    for (const event of events) {
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
    if (changed > 0 || events.length > 0) {
      this.gladys.requestWidgetRefresh(WIDGETS.MOWER);
    }
  }

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(
      [...this.records.keys()].map((id) =>
        buildMowerDevice(this.gladys, this.mowerOf(id), this.config.language),
      ),
    );
  }

  // --- Discovery ---------------------------------------------------------------------

  /** The user asked for a scan: read the account again (a new mower, a renamed one). */
  async scan() {
    if (this.auth.signedIn && !this.fatal) {
      try {
        await this.readList();
        return;
      } catch (err) {
        await this.reportError(err);
      }
    }
    await this.publishDevices();
  }

  /** A device was created: the SDK forgot its states, publish them now. */
  async deviceCreated() {
    await this.publish([...this.records.keys()]);
  }

  // --- Sign-in ---------------------------------------------------------------------------

  /** The Connect button: the sign-in page, coming back to `redirectUri`. */
  authorizeUrl(key, redirectUri) {
    if (key !== ACCOUNT_KEY) {
      throw new Error(`Unknown account field ${key}`);
    }
    if (!redirectUri) {
      throw new Error('No redirect URI');
    }
    return this.auth.authorizeUrl(redirectUri);
  }

  /** The sign-in page came back: exchange the code, then start (acked within 5 s). */
  async oauthCallback(key, { code, state, redirectUri } = {}) {
    if (key !== ACCOUNT_KEY || !this.auth.takeState(state)) {
      throw new Error(T.stateMismatch);
    }
    if (!code) {
      throw new Error('No authorization code');
    }
    await this.auth.exchangeCode(code, redirectUri, { timeout: CALLBACK_TIMEOUT });
    this.lastStatus = undefined;
    await this.setStatus(true, T.signedInNoList);
    this.restart();
  }

  /** The manual sign-in: the address of the page the sign-in ended on, pasted by the user. */
  async signInWithUrl(fields = {}) {
    const code = codeFromInput(fields.url);
    if (!code) {
      return T.noCode;
    }
    try {
      await this.auth.exchangeCode(code, OAUTH.MANUAL_REDIRECT_URI);
    } catch (err) {
      return err.code === 'refused' ? T.codeRefused : T.unreachable(reasonOf(err));
    }
    this.lastStatus = undefined;
    await this.start(this.gladys.config ?? {});
    return this.fatal || !this.healthy ? T.signedInNoList : T.signedIn(this.records.size);
  }

  // --- Lookups ------------------------------------------------------------------------

  async ensureMowers() {
    if (!this.auth.signedIn) {
      throw new Error(T.notSignedIn.en);
    }
    if (this.fatal) {
      throw new Error(T.refused.en);
    }
    if (this.records.size === 0) {
      await this.readList();
    }
  }

  /** A mower from its device external id, its Navimow id or its name. */
  mowerFor(value) {
    const wanted = String(value ?? '').trim();
    const part = parseExternalId(wanted) ?? wanted;
    for (const id of this.records.keys()) {
      if (id === part || safeId(id) === part) {
        return this.mowerOf(id);
      }
    }
    const fold = (s) =>
      String(s ?? '')
        .trim()
        .toLowerCase();
    for (const id of this.records.keys()) {
      if (wanted && fold(this.records.get(id).name) === fold(wanted)) {
        return this.mowerOf(id);
      }
    }
    throw new Error(T.unknownMower(value ?? '').en);
  }

  /** The mowers a scene action targets: the one chosen, or all of them. */
  async targets(value) {
    await this.ensureMowers();
    const list = value
      ? [this.mowerFor(value)]
      : [...this.records.keys()].map((id) => this.mowerOf(id));
    if (list.length === 0) {
      throw new Error(T.noMowerForCommand.en);
    }
    return list;
  }

  // --- Commands ------------------------------------------------------------------------

  /** Read the status back COMMAND_SETTLE after a command (one timer for all). */
  settle() {
    this.timers.clearTimeout(this.settleTimer);
    this.settleTimer = this.timers.setTimeout(() => {
      this.settleTimer = undefined;
      return this.readStatuses().catch((err) =>
        this.logger.warn(`Read back failed: ${err.message}`),
      );
    }, COMMAND_SETTLE);
  }

  /** One command to one mower: start | pause | resume | dock. */
  async command(mower, name) {
    await this.client.command(mower.id, name);
    this.logger.info(`${mower.name}: ${name}`);
    this.settle();
  }

  /** Gladys command: the run mode select (idle: pause, clean: mow) or the dock button. */
  async setValue(device, feature, value) {
    if (parseExternalId(device.external_id) === undefined) {
      throw new Error(`${device.external_id} is not a mower`);
    }
    await this.ensureMowers();
    const mower = this.mowerFor(device.external_id);
    const key = featureKeyOf(feature.external_id);
    if (key === FEATURE.RUN_MODE) {
      const mode = Number(value);
      if (mode === RUN_MODE.CLEANING) {
        await this.command(mower, mower.activity === 'paused' ? 'resume' : 'start');
      } else if (mode === RUN_MODE.IDLE) {
        await this.command(mower, 'pause');
      } else {
        throw new Error(`Run mode ${value} is not supported by a mower`);
      }
      // Gladys shows the requested mode at once: let the read back re-send
      // the real one if the mower did not follow.
      this.gladys.forgetPublishedStates(feature.external_id);
    } else if (key === FEATURE.DOCK) {
      await this.command(mower, 'dock');
    } else {
      throw new Error(`${feature.external_id} is not a command`);
    }
  }

  // --- Scene actions ---------------------------------------------------------------

  async run(fields = {}, name) {
    const list = await this.targets(fields.mower);
    for (const mower of list) {
      await this.command(mower, name);
    }
    return { mower_name: list.map((m) => m.name).join(', '), count: list.length };
  }

  // --- Widget ----------------------------------------------------------------------

  async getWidget({ settings = {}, language } = {}) {
    let mower;
    try {
      mower = settings.mower
        ? this.mowerFor(settings.mower)
        : this.records.size > 0
          ? this.mowerOf([...this.records.keys()][0])
          : undefined;
    } catch {
      mower = undefined;
    }
    return mowerWidget({
      reading: mower ? (this.readings.get(mower.id) ?? mower) : undefined,
      live: this.live.connected,
      language: language === 'fr' ? 'fr' : 'en',
    });
  }

  async widgetAction(actionKey, params = {}) {
    try {
      await this.ensureMowers();
      const mower = this.mowerFor(params.mower);
      if (!Object.values(WIDGET_ACTIONS).includes(actionKey)) {
        throw new Error(`unknown action ${actionKey}`);
      }
      await this.command(mower, actionKey);
      return T.widget.sent[actionKey](mower.name);
    } catch (err) {
      return T.widget.failed(err.message);
    }
  }

  // --- Configuration screen button --------------------------------------------------

  async testConnection() {
    if (!this.auth.signedIn) {
      return T.notSignedIn;
    }
    if (this.auth.refused) {
      return T.refused;
    }
    try {
      await this.readList();
      await this.readStatuses();
      if (this.fatal || !this.tickTimer) {
        // The account works again (or never started): start for real.
        await this.start(this.gladys.config ?? {});
      }
      return T.test({
        mowers: [...this.records.keys()].map((id) => this.mowerOf(id)),
        live: this.live.connected,
      });
    } catch (err) {
      if (isFinal(err)) {
        await this.reportError(err);
        return T.refused;
      }
      return T.unreachable(reasonOf(err));
    }
  }
}
