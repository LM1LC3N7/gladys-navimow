#!/usr/bin/env bash
# End to end in Docker, without a Navimow account: builds the integration
# image, starts a real Mosquitto (TCP + websockets listeners, password) and
# the fake Navimow cloud (e2e/fake-cloud.mjs: HTTPS REST, token endpoint and a
# WSS proxy checking the bearer token) on a Docker network, then runs
# e2e/in-image.mjs inside the image under the Gladys sandbox limits
# (read-only rootfs, 256 MB, 0.5 CPU, non-root, /data volume). Last, checks
# that the entry point starts read-only (it stops at once without the Gladys
# environment variables, as expected).
set -euo pipefail
cd "$(dirname "$0")/.."
NET=navimow-e2e
WORK="$HOME/.cache/navimow-e2e"
mkdir -p "$WORK/certs"

# A test CA and a server certificate for "navimow-fake".
if [ ! -f "$WORK/certs/server.crt" ]; then
  docker run --rm -v "$WORK/certs:/certs" alpine:3 sh -c '
    apk add -q openssl >/dev/null && cd /certs &&
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=navimow-e2e-ca" \
      -keyout ca.key -out ca.crt 2>/dev/null &&
    openssl req -newkey rsa:2048 -nodes -subj "/CN=navimow-fake" \
      -keyout server.key -out server.csr 2>/dev/null &&
    printf "subjectAltName=DNS:navimow-fake\n" > ext.cnf &&
    openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
      -days 30 -extfile ext.cnf -out server.crt 2>/dev/null &&
    chmod 644 /certs/*'
fi

cat > "$WORK/mosquitto.conf" <<'EOF'
listener 1883
protocol mqtt
listener 8080
protocol websockets
allow_anonymous false
password_file /tmp/passwd
log_type all
EOF

docker build -q -t gladys-navimow:e2e . >/dev/null
docker image ls gladys-navimow:e2e --format 'image size: {{.Size}}'
docker network create "$NET" >/dev/null 2>&1 || true
docker rm -f navimow-mosquitto navimow-fake >/dev/null 2>&1 || true
cleanup() {
  docker rm -f navimow-mosquitto navimow-fake >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm navimow-e2e-data >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm --name navimow-mosquitto --network "$NET" \
  -v "$WORK/mosquitto.conf:/mosquitto/config/e2e.conf:ro" eclipse-mosquitto:2 \
  sh -c 'mosquitto_passwd -c -b /tmp/passwd e2e-user e2e-password && chown mosquitto:mosquitto /tmp/passwd && chmod 0700 /tmp/passwd &&
    mosquitto -c /mosquitto/config/e2e.conf' >/dev/null
docker run -d --rm --name navimow-fake --network "$NET" -v "$PWD:/repo:ro"   -e MOSQUITTO=navimow-mosquitto \
  -v "$WORK/certs:/certs:ro" -w /repo node:24-alpine node e2e/fake-cloud.mjs >/dev/null
sleep 2

docker volume create navimow-e2e-data >/dev/null
if ! docker run --rm --read-only --memory 256m --cpus 0.5 --network "$NET" \
  -e NODE_EXTRA_CA_CERTS=/certs/ca.crt -v "$WORK/certs/ca.crt:/certs/ca.crt:ro" \
  -v navimow-e2e-data:/data -v "$PWD/e2e:/app/e2e:ro" gladys-navimow:e2e \
  node /app/e2e/in-image.mjs; then
  echo '--- mosquitto:'
  docker logs navimow-mosquitto 2>&1 | grep -v -i 'ping' | tail -40
  echo '--- fake cloud:'
  docker logs navimow-fake 2>&1 | tail -20
  exit 1
fi
echo '--- the entry point, read-only, without Gladys (expected: the SDK asks for its env)'
docker run --rm --read-only --memory 256m --cpus 0.5 -v navimow-e2e-data:/data \
  gladys-navimow:e2e 2>&1 | grep -v "^    at " | head -4 || true
echo '--- notices shipped in the image'
docker run --rm --read-only gladys-navimow:e2e ls LICENSE THIRD_PARTY_NOTICES.md
