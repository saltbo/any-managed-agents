FROM docker.io/cloudflare/sandbox:0.10.1

RUN npm install -g @earendil-works/pi-coding-agent

COPY server/runtime/pi/pi-bridge.mjs /opt/ama/pi-bridge.mjs
COPY server/runtime/pi/ama-sandbox-tools.mjs /opt/ama/ama-sandbox-tools.mjs
