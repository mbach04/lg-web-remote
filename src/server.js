import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./storage.js";
import { TvRegistry } from "./tvRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8686);
const store = new JsonStore("client-keys.json");
const registry = new TvRegistry(store);

const REMOTE_BUTTONS = [
  "HOME",
  "BACK",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "ENTER",
  "RED",
  "GREEN",
  "YELLOW",
  "BLUE",
  "PLAY",
  "PAUSE",
  "STOP",
  "REWIND",
  "FASTFORWARD",
  "VOLUMEUP",
  "VOLUMEDOWN",
  "MUTE",
  "CHANNELUP",
  "CHANNELDOWN"
];

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function asyncHandler(handler) {
  return async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      next(error);
    }
  };
}

app.get("/api/config", (_request, response) => {
  response.json({
    remoteButtons: REMOTE_BUTTONS,
    commonActions: [
      {
        label: "Power Off",
        uri: "ssap://system/turnOff"
      },
      {
        label: "Show Toast",
        uri: "ssap://system.notifications/createToast",
        payload: { message: "Hello from LG TV Control Hub" }
      },
      {
        label: "Open Home Dashboard",
        uri: "ssap://system.launcher/open",
        payload: { target: "home" }
      }
    ]
  });
});

app.get("/api/tvs", (_request, response) => {
  response.json(registry.list());
});

app.post("/api/discovery/scan", asyncHandler(async (_request, response) => {
  const tvs = await registry.scan();
  console.log(`Discovery complete: found ${tvs.length} TV(s)`);
  response.json(tvs);
}));

app.post("/api/tvs/manual", asyncHandler(async (request, response) => {
  const tv = registry.addManual(request.body.host, request.body.name);
  response.json(tv);
}));

app.post("/api/tvs/:id/connect", asyncHandler(async (request, response) => {
  const client = registry.client(request.params.id);
  await client.connect();
  response.json({
    ok: true,
    status: client.status,
    connection: client.tv.connection,
    tv: registry.get(request.params.id)
  });
}));

app.get("/api/tvs/:id/dashboard", asyncHandler(async (request, response) => {
  const client = registry.client(request.params.id);
  const dashboard = await client.getDashboard();
  response.json(dashboard);
}));

app.post("/api/tvs/:id/request", asyncHandler(async (request, response) => {
  const client = registry.client(request.params.id);
  const result = await client.request(request.body);
  response.json(result);
}));

app.post("/api/tvs/:id/button", asyncHandler(async (request, response) => {
  const client = registry.client(request.params.id);
  await client.sendRemoteButton(request.body.name);
  response.json({ ok: true });
}));

app.post("/api/tvs/:id/pointer/move", asyncHandler(async (request, response) => {
  const client = registry.client(request.params.id);
  await client.pointerMove(Number(request.body.dx || 0), Number(request.body.dy || 0), Number(request.body.drag || 0));
  response.json({ ok: true });
}));

app.post("/api/tvs/:id/pointer/scroll", asyncHandler(async (request, response) => {
  const client = registry.client(request.params.id);
  await client.scroll(Number(request.body.dx || 0), Number(request.body.dy || 0));
  response.json({ ok: true });
}));

app.post("/api/tvs/:id/text", asyncHandler(async (request, response) => {
  const client = registry.client(request.params.id);
  const result = await client.sendText(String(request.body.text || ""), request.body.replace !== false);
  response.json(result);
}));

app.use((error, _request, response, _next) => {
  response.status(500).json({
    error: error.message || "Unknown error"
  });
});

await registry.scan().catch(() => []);

app.listen(port, "0.0.0.0", () => {
  console.log(`LG TV Control Hub listening on http://0.0.0.0:${port}`);
});
