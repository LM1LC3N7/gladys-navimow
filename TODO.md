# TODO — Segway Navimow v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the batch claimed in /t/10385 (post #224) gets one recap message there, with
  a link to each repo.

## Status

- [x] **Milestone 1 — core** (2026-10-16): sign-in with the Navimow account
      through the OAuth2 flow of Segway's Home Assistant integration (`oauth2`
      Connect button; manual fallback: the address of the page the sign-in
      ends on, pasted in an action), token stored off-schema with
      `setConfig`, renewed 5 minutes before it expires (back-off 1/5/15/60
      minutes on network failures, a refusal asks for a new sign-in);
      device list (`authList`) at start, every 12 h and on a scan; status of
      every mower in one `getVehicleStatus` call every 5 minutes (1–60), every
      2 minutes while the live link is down, 10 s after a command; live link
      MQTT over WSS (mqtt.js) with the broker credentials of
      `mqtt/userInfo/get/v2`, keepalive 60 s, own reconnection, credentials
      fetched again after a renewal or a close; one device per mower
      (vacuum-cleaner state / run mode / dock like gladys-automower, battery,
      activity, error code and text, online, mowing progress and area);
      commands start / pause / resume / dock (`sendCommands`); scene triggers
      `mower_error`, `activity_changed`, `mowing_finished` (outcome),
      `back_to_station`; scene actions `start`, `pause`, `resume`, `dock`;
      the "mower" widget; "Test Navimow"; en/fr names and texts; docs en/fr.
      Tested against made-up answers shaped after navimow-sdk / NavimowHA /
      ioBroker.navimow, the real error answers and the real location
      readings recorded by ioBroker.navimow (112 tests, Node 22 and 24), and
      end to end in Docker (`e2e/run.sh`): the image read-only under 256 MB /
      0.5 CPU (RSS 93 MB), a fake cloud over HTTPS with a WSS proxy checking
      the bearer, a real Mosquitto 2.1; no real account or mower.
- [ ] **Milestone 2 — real account**: run against a real account and mower,
      compare with the app (see "To check on a real account"); turn the
      answers (anonymized) into fixtures; add what real payloads need.
- [ ] **Milestone 3 — more**:
  - the mowing map (positions of the `location` channel, ioBroker.navimow
    draws it with @napi-rs/canvas): out of scope in milestone 1; would need
    a PNG encoder light enough for 256 MB, a widget image, and a session
    logic like ioBroker's;
  - the `event` and `attributes` channels (logged at debug level today):
    once their content is known, an "event" trigger and the attributes
    (blade height? rain sensor?) as features;
  - `mower_disconnected` trigger (online flag true -> false), like
    gladys-automower;
  - blade height: NavimowHA declares a `set_blade_height` service that the
    REST API does not support (it raises); navimow-sdk only publishes it on
    an MQTT command topic (`navimow/<id>/command`) that NavimowHA does not
    use: to watch;
  - the weekly mowed area (`mowingWeekArea`) as a feature.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## To check on a real account

- **The Connect button**: Segway's sign-in page (read 2026-10-16) sends the
  browser to `<redirect_uri>?code=…&state=…` without checking the address,
  so Gladys' redirect page (`https://my.gladysassistant.com/redirect/oauth`
  with a wrapped state, or the instance's own address) should work. To
  confirm: the token endpoint accepts that `redirect_uri` with the code
  (NavimowHA sends `https://my.home-assistant.io/redirect/oauth`, ioBroker
  `http://localhost:1/callback`: both work for their users), and the wrapped
  state (base64url, < 4 KB) comes back intact.
- The token answer: `expires_in` (ioBroker renews at about 55 minutes:
  3600?), a `refresh_token` in the first answer (NavimowHA's comment says
  the first token may have none: then the session ends with the token), a
  new `refresh_token` at each renewal or the same one, the lifetime of the
  refresh token (NavimowHA: "1-2 days"?).
- `authList`: the field names of a real device (`name` a string? `model`,
  `firmware_version`, `serial_number`, `online`), the format of `id`
  (the external id keeps `[A-Za-z0-9_.-]` and replaces the rest).
- `getVehicleStatus`: the real entry (`vehicleState`, `capacityRemaining`,
  `descriptiveCapacityRemaining`, `online`?, `isCharging`?, an error field?),
  whether a Google-style `status: "SUCCESS"` comes with it (ignored here),
  and how far behind the live state it runs.
- The `state` channel: its fields (`state`, `battery`, `error`?,
  `timestamp`), which states it reports while docked and charging (does
  "charging" ever show, or only `isDocked`?), and what an error looks like
  (code numbers? messages? `isLifted` alone?).
- The `location` channel: `mowingPercentage` and `subtotalArea` on a real
  session, a zone task (no progress at all, says ioBroker), a charging break.
- The `event` and `attributes` channels: their content (logged at debug).
- `mqtt/userInfo/get/v2`: the broker address (`mqttHost`, `mqttUrl`), the
  "url Circuit Breaker" answer and how long it lasts.
- MQTT: the CONNACK of an expired credential, whether the broker accepts the
  same client id after a reconnection, and that keepalive 60 s keeps the
  link alive while the mower is docked (ioBroker measured a 10-minute reaper
  with a longer keepalive).
- Commands: the answers of `sendCommands` (`status`, `errorCode` values when
  the mower is offline, lifted or in the station), whether `resume` works on
  a mower paused from the app, and whether `start` from the station needs a
  full battery.
- Rate limits: none documented; watch for HTTP 429 or new API codes.

## Decisions

- **Not a duplicate** (checked 2026-10-16): the store index (433 entries,
  generated 2026-10-16T11:15Z) and its `rejected.json` have no Navimow,
  Segway or Ninebot integration (mowers in the store: LM1LC3N7/
  gladys-automower, guim31/gladys-landroid, Nagromdark/gladys-gardena,
  prohand/gladys-mammotion, prohand/gladys-ecovacs); GitHub search
  "gladys navimow" / "gladys segway" finds only this repository; the forum
  search finds only the claim (/t/10385 #224); the Gladys core master
  (0027571e, 2026-10-16) has no Navimow service. Tracker n° 411.
- **Reuse** (Louis's rule: maintained work first, our own code only where it
  is missing or a burden):
  - Segway's **navimow-sdk** (Python, 0.1.2 on PyPI; its pyproject says MIT
    but its LICENSE file is GPL-3.0 and its README "GPL License") and
    **NavimowHA** 1.1.1 (no licence file): the reference of the API, read as
    documentation only (endpoints, field names, codes, the OAuth2 client of
    `const.py`); nothing copied.
  - **ioBroker.navimow** 1.1.2 (TA2k, MIT, 2026-08-31, very active: commits
    on 2026-10-16): the same REST + MQTT in Node, but an ioBroker adapter,
    not a library. Ported (credited in THIRD_PARTY_NOTICES.md and the file
    headers): the broker address and mqtt.js options, keepalive 60 s, the
    topics, the credential refresh on a closed connection, the late
    location readings dropped by type and time. Its map (`@napi-rs/canvas`,
    a native module) is skipped: out of scope and too heavy.
  - **mqtt** (mqtt.js 5.16.1, MIT, published 2026-10-14, the reference MQTT
    client of Node, also used by gladys-niko-home-control): the live link
    over WSS with the `Authorization` header (`wsOptions.headers`).
    `npm audit --omit=dev`: 0 vulnerability.
  - Everything else (OAuth2, REST, model) is our own small code on `fetch`.
- **The OAuth2 client of Segway's Home Assistant integration**
  (`client_id` homeassistant, the secret published in NavimowHA's
  `const.py`, `channel=homeassistant`), as ioBroker.navimow uses it: Segway
  offers no developer registration. If Segway publishes a client for other
  platforms, switch to it (one place: `OAUTH` in `src/constants.js`).
- **Connect button (`oauth2`) + manual fallback**: Gladys' generic OAuth2
  relay fits Segway's page (it echoes `state` and goes back to any
  `redirect_uri`); the manual sign-in (the address of the page the sign-in
  ends on, pasted in the `sign_in_with_url` action) is the path ioBroker's
  users take, kept in case the Connect round trip fails on a setup.
- **Tokens with `setConfig`** under `navimow_token` (outside the
  config_schema, as the SDK README advises): they survive a container
  restart and an image update, and Gladys never echoes an integration's own
  `setConfig` (no restart loop). The anti-CSRF states live in memory (30
  minutes): a container restarted between Connect and the callback asks for
  one more click.
- **Category `vacuum-cleaner`**, like gladys-automower (the only Gladys
  category of a robot that runs, docks and charges); run mode Clean = start
  (resume when paused), Idle = pause; the dock button = Dock. Progress =
  `unknown`/`integer` in %, area = `surface`/`decimal` in m² (the core only
  restricts units per category in the front).
- **Activities**: the vehicle states of the cloud (isRunning, isMapping,
  isPaused, isDocking, isDocked, isIdle/isIdel, isLifted, Error,
  inSoftwareUpdate, Self-Checking, Offline) mapped to 13 activities; a
  docked mower that says `isCharging` is "charging" (Google EnergyStorage;
  not seen in the references yet).
- **Errors**: from the `error` object or the `error_code`/`errorCode` and
  `error_message` fields (navimow-sdk); an error activity (lifted, error)
  is an error by itself; a new state without error information clears the
  error. Error code feature: 0 none, the numeric code, -1 without one.
- **Live vs REST**: the live state owns the state for 3 minutes (ioBroker:
  the REST status answered "isDocked" for a mower out mowing); a docked
  mower falls quiet on MQTT, the 5-minute REST read keeps its battery fresh.
- **Triggers**: `mowing_finished` carries an outcome (complete at 100 %,
  interrupted below, unknown without a progress of this session) because a
  charging break also ends in the station; `back_to_station` fires on every
  arrival but not when the cloud sees an offline mower again.
- **Commands are REST** (`sendCommands`, Google smart home traits), as
  NavimowHA and ioBroker.navimow do; navimow-sdk's MQTT command topic is not
  used by Segway's own integration.
