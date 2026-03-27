# LG TV Control Hub

A containerized web app for discovering and controlling multiple LG webOS TVs from one browser UI.

## What it does

- Auto-discovers LG TVs over SSDP using the LG second-screen service advertisement
- Resolves each TV's friendly name, model name, and model number from the device description XML
- Persists LG pairing keys so you only need to approve the TV once
- Exposes a browser UI with:
  - remote control buttons
  - pointer/touchpad control
  - text entry into focused TV fields
  - app launching
  - input switching
  - channel tuning
  - dashboard state for app, volume, and channel
  - a raw SSAP API explorer so you can invoke any supported TV endpoint directly

## Why the app includes a raw API explorer

LG TVs expose a broad SSAP API surface and that varies a bit by model and software version. The app includes common controls out of the box, plus a raw request tool so you can reach the rest of the available API without waiting on another UI update.

## Run with Docker Compose

Because SSDP discovery relies on multicast on the local network, host networking is the simplest option on Linux:

```bash
docker compose up --build
```

Then open [http://localhost:8080](http://localhost:8080).

## Run with plain Docker

```bash
docker build -t lg-tv-control-hub .
docker run --rm \
  --network host \
  -e PORT=8080 \
  -e DATA_DIR=/app/data \
  -v "$(pwd)/data:/app/data" \
  lg-tv-control-hub
```

## Notes

- On first connect, approve the pairing prompt shown on the TV.
- Pairing keys are stored in [`data/client-keys.json`](/Users/matthewbach/Documents/Playground/data/client-keys.json) inside the mounted data volume.
- Some SSAP endpoints are model-specific. If a command is unsupported, use the raw API explorer to inspect the error response and adjust the payload for that TV.
- `network_mode: host` works best on Linux. Docker Desktop on macOS often does not forward multicast discovery cleanly into containers, so local discovery may be limited there unless you run the app directly on the host.
