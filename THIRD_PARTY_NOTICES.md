# Third-party notices

## TA2k/ioBroker.navimow (https://github.com/TA2k/ioBroker.navimow)

Parts of `src/navimow/live.js` are adapted from `main.js` of ioBroker.navimow
1.1.2 (commit f9a652d of 2026-10-16): the broker address built from the
answer of `mqtt/userInfo/get/v2` (`mqttUrl`, `mqttHost`, port 443 for wss,
the TCP fallback on 1883), the mqtt.js options (client id
`web_<userName>_<10 hex>`, keepalive 60 s, the bearer token in
`wsOptions.headers`), the four topics
`/downlink/vehicle/<id>/realtimeDate/<channel>`, and the rule that refreshes
the broker credentials on a closed connection (at once when it had been up,
at most every 10 minutes when it never came up). `src/navimow/model.js`
follows its handling of the `location` channel (numbers sent as strings,
readings delivered late dropped per reading type and time, a clock far ahead
not trusted) and its battery fallback on `capacityRemaining`.
`test/fixtures/location.json` holds four location readings its tests
(`main.test.js`) recorded from a real mower.

```text
MIT License

Copyright (c) 2026 TA2k <tombox2020@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Read as documentation only (no code copied)

- **segwaynavimow/navimow-sdk** (https://github.com/segwaynavimow/navimow-sdk,
  0.1.2, commit 6596aa0): the REST endpoints (`authList`,
  `getVehicleStatus`, `sendCommands`, `mqtt/userInfo/get/v2`), the `code`
  of the answers, the command traits, the vehicle states and their canonical
  names, the error kinds, the MQTT topics and payload fields. Its pyproject
  declares MIT while its LICENSE file is the GPL-3.0: nothing of it is
  copied here, only the facts of the API.
- **segwaynavimow/NavimowHA** (https://github.com/segwaynavimow/NavimowHA,
  1.1.1, commit 37fb1d4, no licence file): the OAuth2 flow (sign-in page,
  token endpoint, client id and secret, `channel=homeassistant`), the MQTT
  credentials bound to the token, the circuit breaker of the credentials
  endpoint, the live state preferred over a lagging REST status.

## Runtime dependencies

- `@gladysassistant/integration-sdk` (Apache-2.0) and its dependency `ws`
  (MIT).
- `mqtt` (mqtt.js, MIT) and its dependencies (MIT, ISC, 0BSD, BSD-3-Clause),
  installed from npm into the image with their own licence files.
