// -----------------------------------------------------------------------------
// End to end: a fake Navimow cloud. HTTPS on 8443 (certificate of the e2e CA):
// the token endpoint, the four open API endpoints, and /mqtt, a WebSocket
// proxy that checks the bearer token of the handshake before piping it to the
// real Mosquitto (websockets listener). The fake mower publishes through
// Mosquitto's TCP listener. /e2e/* is the control surface of the test.
// Run with the repository mounted at /repo (mqtt.js from its node_modules).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';

// mqtt.js from the repository's node_modules (this script runs outside it).
const mqtt = createRequire('/repo/package.json')('mqtt');

const CERTS = process.env.CERTS ?? '/certs';
const MOSQUITTO = process.env.MOSQUITTO ?? 'mosquitto';
const BROKER_USER = 'e2e-user';
const BROKER_PASSWORD = 'e2e-password';
const MOWER = 'NVM6E2C1A90B47D';

let issued = 0;
const valid = new Set();
const refreshTokens = new Set();
const calls = [];
const upgrades = [];

function issue() {
  issued += 1;
  const token = {
    access_token: `e2e-access-${issued}`,
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: `e2e-refresh-${issued}`,
  };
  valid.add(token.access_token);
  refreshTokens.add(token.refresh_token);
  return token;
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

const mower = mqtt.connect(`mqtt://${MOSQUITTO}:1883`, {
  username: BROKER_USER,
  password: BROKER_PASSWORD,
  clientId: 'e2e-fake-mower',
});
mower.on('error', (err) => console.error(`fake mower: ${err.message}`));

const server = createServer(
  { key: readFileSync(`${CERTS}/server.key`), cert: readFileSync(`${CERTS}/server.crt`) },
  async (req, res) => {
    const url = new URL(req.url, 'https://navimow-fake');
    const text = await readBody(req);
    const auth = req.headers.authorization ?? '';
    calls.push({ method: req.method, path: url.pathname, auth, body: text });

    // --- Control surface of the test ---------------------------------------------
    if (url.pathname === '/e2e/publish') {
      const { channel, payload } = JSON.parse(text);
      mower.publish(`/downlink/vehicle/${MOWER}/realtimeDate/${channel}`, JSON.stringify(payload));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/e2e/calls') {
      return send(res, 200, { calls, upgrades });
    }

    // --- The token endpoint --------------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/openapi/oauth/getAccessToken') {
      const form = Object.fromEntries(new URLSearchParams(text));
      if (form.client_id !== 'homeassistant' || !form.client_secret) {
        return send(res, 401, { error: 'invalid_client' });
      }
      if (form.grant_type === 'authorization_code' && form.code === 'e2e-code') {
        return send(res, 200, issue());
      }
      if (form.grant_type === 'refresh_token' && refreshTokens.delete(form.refresh_token)) {
        return send(res, 200, issue());
      }
      return send(res, 400, { error: 'invalid_grant' });
    }

    // --- The open API --------------------------------------------------------------
    if (!auth) {
      return send(res, 200, { code: 4003, desc: 'TOKEN_EMPTY' });
    }
    if (!valid.has(auth.replace(/^Bearer /, ''))) {
      return send(res, 200, { code: 4005, desc: 'CODE_OAUTH_INFO_ILLEGAL' });
    }
    if (url.pathname === '/openapi/smarthome/authList') {
      return send(res, 200, {
        code: 1,
        desc: 'success',
        data: {
          payload: {
            devices: [
              {
                id: MOWER,
                name: 'Pelouse',
                model: 'Navimow i105E',
                firmware_version: '1.4.2',
                serial_number: 'N1E0A7C2B9F4D3',
                online: true,
              },
            ],
          },
        },
      });
    }
    if (url.pathname === '/openapi/smarthome/getVehicleStatus') {
      return send(res, 200, {
        code: 1,
        desc: 'success',
        data: {
          payload: {
            devices: [
              {
                id: MOWER,
                online: true,
                vehicleState: 'isDocked',
                capacityRemaining: [{ rawValue: 80, unit: 'PERCENTAGE' }],
              },
            ],
          },
        },
      });
    }
    if (url.pathname === '/openapi/smarthome/sendCommands') {
      return send(res, 200, {
        code: 1,
        desc: 'success',
        data: { payload: { commands: [{ ids: [MOWER], status: 'SUCCESS' }] } },
      });
    }
    if (url.pathname === '/openapi/mqtt/userInfo/get/v2') {
      return send(res, 200, {
        code: 1,
        desc: 'success',
        data: {
          mqttHost: 'wss://navimow-fake:8443',
          mqttUrl: 'wss://navimow-fake:8443/mqtt',
          userName: BROKER_USER,
          pwdInfo: BROKER_PASSWORD,
        },
      });
    }
    return send(res, 404, { code: 404, desc: 'not found' });
  },
);

// The WebSocket handshake of the live link: the bearer token must be one the
// cloud issued; then the raw connection is piped to Mosquitto.
server.on('upgrade', (req, socket, head) => {
  const auth = req.headers.authorization ?? '';
  const ok = req.url === '/mqtt' && valid.has(auth.replace(/^Bearer /, ''));
  upgrades.push({ url: req.url, auth, ok, protocol: req.headers['sec-websocket-protocol'] });
  if (!ok) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  const upstream = net.connect(8080, MOSQUITTO, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
});

server.listen(8443, () => console.log('fake Navimow cloud on :8443'));
