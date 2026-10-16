# gladys-navimow

[Gladys Assistant](https://gladysassistant.com) external integration for
**Segway Navimow** robotic mowers (the models without a perimeter wire),
through the Navimow cloud, signed in with the account of the Navimow app.
One device per mower: state, battery, activity, error, online, mowing
progress and area, a mow / pause select and a return to station button; live
updates over MQTT; scene triggers when an error occurs, the activity changes,
the mowing ends or the mower is back in its station; scene actions to start,
pause, resume and send it back; a dashboard widget. Unofficial, not affiliated
with Segway or Navimow.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (0.1, not published to the store yet).** Tested with
> simulated answers, not yet with a real Navimow account. Feedback and bug
> reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-navimow/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (NavimowApp) ─┬─ src/navimow/auth.js    OAuth2, token renewal
                                                           ├─ src/navimow/client.js  REST: navimow-fra.ninebot.com
                                                           ├─ src/navimow/live.js    MQTT over WSS (mqtt.js)
                                                           ├─ src/navimow/model.js   Navimow JSON -> plain values (pure)
                                                           ├─ src/devices.js         -> Gladys devices and states (pure)
                                                           ├─ src/triggers.js        two readings -> scene events (pure)
                                                           └─ src/widget.js          the "mower" widget (pure)
```

- **Account**: the OAuth2 authorization-code flow of Segway's own Home
  Assistant integration (NavimowHA). The `account` field of the manifest is
  an `oauth2` field: Gladys shows a **Connect** button, the integration builds
  the sign-in URL (`navimow-h5-fra.willand.com/smartHome/login`, client
  `homeassistant`, an anti-CSRF state), Segway's page sends the browser back
  to Gladys with a code, and the integration exchanges it at
  `POST /openapi/oauth/getAccessToken`. Fallback: the user signs in on the
  same page with the `http://localhost:1/callback` redirect (as the ioBroker
  adapter does) and pastes the address of the error page in the
  `sign_in_with_url` action. The token is stored with `setConfig`
  (`navimow_token`, outside the schema) and renewed 5 minutes before it
  expires; a refused renewal asks for a new sign-in.
- **Reading**: `GET /openapi/smarthome/authList` (the mowers) at start, every
  12 hours and on a Discovery scan; `POST /openapi/smarthome/getVehicleStatus`
  (state, battery) for every mower in one call every 5 minutes (1 to 60),
  every 2 minutes while the live link is down, 10 s after a command.
- **Live**: `GET /openapi/mqtt/userInfo/get/v2` gives the broker and its
  credentials; mqtt.js connects over a secure WebSocket (bearer token in the
  handshake, keepalive 60 s) and subscribes
  `/downlink/vehicle/<id>/realtimeDate/{state,event,attributes,location}`.
  `state` carries the state and battery, `location` the mowing progress and
  area (positions are dropped). The live state owns the state for 3 minutes:
  the REST status is a cache that runs behind.
- **Commands**: `POST /openapi/smarthome/sendCommands` with the Google smart
  home traits (`StartStop`, `PauseUnpause`, `Dock`); `alreadyInState` counts
  as done.
- **Devices**: `ext:<selector>:mower:<Navimow id>`; the state, run mode and
  dock button use Gladys' `vacuum-cleaner` category, like
  [gladys-automower](https://github.com/LM1LC3N7/gladys-automower).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/` holds Navimow answers shaped after navimow-sdk, NavimowHA and
ioBroker.navimow, the real error answers of the API and the real location
readings ioBroker.navimow recorded (sources in
[test/fixtures/README.md](test/fixtures/README.md));
`test/helpers/fakeNavimow.js` serves them behind `fetch`, and
`test/helpers/fakeBroker.js` is an in-memory MQTT broker.

`bash e2e/run.sh` (Docker) runs the production image read-only under 256 MB
and 0.5 CPU against a fake Navimow cloud (`e2e/fake-cloud.mjs`: HTTPS REST,
token endpoint, and a WebSocket proxy that checks the bearer token) in front
of a real Mosquitto: Connect flow, live messages, events, a command, a token
renewal with the reconnection of the live link.

## Credits

- [navimow-sdk](https://github.com/segwaynavimow/navimow-sdk) and
  [NavimowHA](https://github.com/segwaynavimow/NavimowHA) (Segway Navimow):
  the official SDK and Home Assistant integration, read as the documentation
  of the API (endpoints, fields, states, commands, OAuth2 flow); no code
  copied.
- [ioBroker.navimow](https://github.com/TA2k/ioBroker.navimow) (MIT, TA2k):
  the MQTT connection (broker address and options, keepalive, topics,
  credential refresh) and the handling of late location readings are adapted
  from it, and its recorded location readings serve as test fixtures; see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [mqtt.js](https://github.com/mqttjs/MQTT.js) (MIT): the MQTT client.
- [gladys-automower](https://github.com/LM1LC3N7/gladys-automower): the mower
  model in Gladys (device, triggers, scene actions, widget).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0. Segway and Navimow are trademarks of their owners; this project is
not affiliated with Segway or Navimow.
