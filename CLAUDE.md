# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), with
`mqtt` (mqtt.js 5) as its only other runtime dependency. It signs in to the
**Segway Navimow** cloud with the OAuth2 flow of Segway's own Home Assistant
integration (an `oauth2` Connect button, or an address pasted by hand), reads
the robotic mowers over REST, follows them live over MQTT on a secure
WebSocket, and exposes one device per mower with a mow / pause select and a
dock button, scene triggers, scene actions and a dashboard widget, the way
LM1LC3N7/gladys-automower does for Husqvarna. Unofficial: not affiliated with
Segway or Navimow.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js                SDK bootstrap only
src/handlers.js         every SDK handler -> the app (shared with the tests)
src/app.js              NavimowApp: lifecycle, sign-in, REST loop, live
                        messages, commands, scene triggers and actions,
                        widget, test button
src/navimow/auth.js     OAuth2: sign-in page, anti-CSRF states, code
                        exchange, token renewal and its back-off, NavimowError
src/navimow/client.js   the REST client: bearer, requestId, code check, one
                        renewal on a refused token, the four endpoints
src/navimow/live.js     MQTT over WSS (mqtt.js): broker credentials, topics,
                        own reconnection, credentials refreshed on a close
src/navimow/model.js    Navimow JSON -> plain values (pure)
src/devices.js          the mower device, feature keys, states (pure)
src/triggers.js         readings, transitions -> scene events (pure)
src/widget.js           the "mower" widget (pure)
src/config.js           config_schema normalized (DEFAULTS, BOUNDS) + token
src/constants.js        URLs, paths, client, codes, commands, pacing, Gladys
                        enums, manifest keys
src/i18n.js             runtime texts (en/fr)
src/http.js             the only HTTP access (fetch, timeout, no header in errors)
test/fixtures/          Navimow answers (sources in test/fixtures/README.md)
test/helpers/           fake Navimow cloud (fetch), in-memory MQTT broker,
                        fake timers; Gladys is the SDK's fake
e2e/                    Docker end to end: the image read-only under the
                        Gladys limits, a fake cloud (HTTPS, WSS proxy checking
                        the bearer) and a real Mosquitto (`bash e2e/run.sh`)
```

## Rules

- **Unofficial.** Every user-facing surface says "unofficial connector, not
  affiliated with Segway or Navimow". Never use their logos.
- **Keys are forever**: the manifest keys (`account`, `poll_minutes`,
  `language`, the actions, the four triggers with their fields and
  variables, the four scene actions, the widget and its button actions), the
  `activity` values (`ACTIVITIES`), the `outcome` values (`OUTCOMES`), the
  feature keys (`FEATURE` in `src/devices.js`), the token key
  (`navimow_token`) and the external id shape `mower:<Navimow id, sanitized>`
  are stored in user devices, scenes and dashboards. Never rename them.
- **Tokens are secrets**: the access token travels in the `Authorization`
  header (REST and the WebSocket handshake), the refresh token and the client
  secret in the token endpoint's form body, the broker password in the MQTT
  CONNECT; none of them in a URL, a log line, an error, a status, a state or a
  scene event (`test/app.test.js` checks it). The tokens are stored with
  `setConfig` under `navimow_token`, outside the config_schema (Gladys never
  echoes it back as a config change, and never shows it).
- **A refused sign-in is final** (`NavimowError` codes `refused`, `token`,
  `no_token`): nothing is called until the user clicks Connect again (or uses
  the manual sign-in). A renewal that fails on the network is retried after
  1, 5, 15 then 60 minutes (`renewIfDue`), never on every call.
- **The OAuth2 callback is acked within 5 s**: exchange the code (4 s
  timeout), store the token, report the status, and start in the background.
- **Be gentle with the cloud**: the device list at start, every 12 hours and
  on a scan; the status of every mower in ONE call every `poll_minutes` (5,
  1 to 60), every 2 minutes while the live link is down, 10 s after a command
  (one read back for a burst). The live link carries the rest. The MQTT
  credentials endpoint has a circuit breaker: credentials are fetched again
  only after a renewal, when an established connection closes, after a
  refusal, or every 10 minutes at most for a connection that never came up;
  a cached answer is reused when it fails.
- **The live state wins over REST for 3 minutes** (`STATE_TRUST`): the REST
  status is a cache that runs behind. A late location reading (older than the
  newest one of its type) is dropped.
- **One event per transition** (`src/triggers.js`): the first reading fires
  nothing; `mower_error` once per error; `mowing_finished` when a session
  (it starts by mowing or mapping) ends in the station or idle, with its
  outcome; `back_to_station` on an arrival in the station (not from offline
  or unknown). Never fire an event from a command received from Gladys.
- **The Gladys category**: the state, the run mode and the dock button use
  `vacuum-cleaner`, as gladys-automower does. Should Gladys add a lawn mower
  category, add its features next to these, never instead (keys are forever).
- **Built blind**: no Navimow account was available. Segway's navimow-sdk and
  NavimowHA (read as documentation, nothing copied: navimow-sdk's LICENSE
  file is GPL-3.0) and ioBroker.navimow (MIT, the ported parts credited in
  THIRD_PARTY_NOTICES.md) are the reference; every Navimow name lives in
  `src/navimow/` and `src/constants.js`, so a user report fixes one place.
  `TODO.md` lists what to confirm.
- **No positions**: the location messages are only read for the progress and
  the area; positions are never stored, logged or published.
- **Read-only rootfs**: write nothing on disk (the token is in Gladys).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language, the name at most 30;
  `test/manifest.test.js` ties the manifest to the code (keys, defaults,
  bounds, options, trigger fields and variables against the events the code
  fires, the manual sign-in link).
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network**: `installNavimow` replaces `fetch`, the
  live link takes an injected `connect`; the widget contents pass the SDK's
  `validateWidgetContent`.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  asks otherwise: every push runs the CI (Node 22 and 24, Docker build).
