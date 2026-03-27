import EventEmitter from "node:events";
import WebSocket from "ws";

const REGISTER_PAYLOAD = {
  type: "register",
  payload: {
    forcePairing: false,
    manifest: {
      appVersion: "1.0.0",
      manifestVersion: 1,
      permissions: [
        "LAUNCH",
        "LAUNCH_WEBAPP",
        "APP_TO_APP",
        "CLOSE",
        "TEST_OPEN",
        "TEST_PROTECTED",
        "CONTROL_AUDIO",
        "CONTROL_DISPLAY",
        "CONTROL_INPUT_JOYSTICK",
        "CONTROL_INPUT_MEDIA_PLAYBACK",
        "CONTROL_INPUT_MEDIA_RECORDING",
        "CONTROL_INPUT_TV",
        "CONTROL_MOUSE_AND_KEYBOARD",
        "CONTROL_POWER",
        "CONTROL_TV_SCREEN",
        "CONTROL_TV_STANBY",
        "CONTROL_FAVORITE_GROUP",
        "CONTROL_USER_INFO",
        "READ_APP_STATUS",
        "READ_CURRENT_CHANNEL",
        "READ_INPUT_DEVICE_LIST",
        "READ_INSTALLED_APPS",
        "READ_LGE_SDX",
        "READ_NETWORK_STATE",
        "READ_RUNNING_APPS",
        "READ_TV_CHANNEL_LIST",
        "READ_TV_CURRENT_TIME",
        "READ_TV_PROGRAM_INFO",
        "READ_TV_SCHEDULE",
        "READ_UPDATE_INFO",
        "UPDATE_FROM_REMOTE_APP",
        "WRITE_NOTIFICATION_ALERT",
        "WRITE_SETTINGS"
      ],
      signatures: [
        {
          signatureVersion: 1,
          signature:
            "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.LG5vbmU.LG5vbmU"
        }
      ],
      signed: {
        appId: "com.codex.lg-tv-control-hub",
        created: "2026-03-26",
        localizedAppNames: {
          "": "LG TV Control Hub"
        },
        permissions: [
          "LAUNCH",
          "LAUNCH_WEBAPP",
          "APP_TO_APP",
          "CLOSE",
          "TEST_OPEN",
          "TEST_PROTECTED",
          "CONTROL_AUDIO",
          "CONTROL_DISPLAY",
          "CONTROL_INPUT_JOYSTICK",
          "CONTROL_INPUT_MEDIA_PLAYBACK",
          "CONTROL_INPUT_MEDIA_RECORDING",
          "CONTROL_INPUT_TV",
          "CONTROL_MOUSE_AND_KEYBOARD",
          "CONTROL_POWER",
          "CONTROL_TV_SCREEN",
          "CONTROL_TV_STANBY",
          "CONTROL_FAVORITE_GROUP",
          "CONTROL_USER_INFO",
          "READ_APP_STATUS",
          "READ_CURRENT_CHANNEL",
          "READ_INPUT_DEVICE_LIST",
          "READ_INSTALLED_APPS",
          "READ_LGE_SDX",
          "READ_NETWORK_STATE",
          "READ_RUNNING_APPS",
          "READ_TV_CHANNEL_LIST",
          "READ_TV_CURRENT_TIME",
          "READ_TV_PROGRAM_INFO",
          "READ_TV_SCHEDULE",
          "READ_UPDATE_INFO",
          "UPDATE_FROM_REMOTE_APP",
          "WRITE_NOTIFICATION_ALERT",
          "WRITE_SETTINGS"
        ],
        serial: "codex-control-hub"
      }
    }
  }
};

const DEFAULT_TIMEOUT_MS = 8000;

function wsUrl(host, secure = false) {
  return `${secure ? "wss" : "ws"}://${host}:${secure ? 3001 : 3000}`;
}

export class LgTvClient extends EventEmitter {
  constructor(tv, store) {
    super();
    this.tv = tv;
    this.store = store;
    this.socket = null;
    this.requestId = 0;
    this.pending = new Map();
    this.pointerSocket = null;
    this.pointerReady = null;
    this.connecting = null;
    this.status = "disconnected";
    this.lastError = null;
  }

  get clientKeys() {
    return this.store.read();
  }

  get clientKey() {
    return this.clientKeys[this.tv.id] || null;
  }

  saveClientKey(value) {
    const keys = this.clientKeys;
    keys[this.tv.id] = value;
    this.store.write(keys);
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = this.#connectWithFallback();
    try {
      await this.connecting;
      return this;
    } finally {
      this.connecting = null;
    }
  }

  async #connectWithFallback() {
    try {
      await this.#openSocket(false);
    } catch (error) {
      await this.#openSocket(true);
    }
  }

  async #openSocket(secure) {
    this.status = "connecting";
    this.emit("status", this.status);
    this.lastError = null;

    const socket = new WebSocket(wsUrl(this.tv.ip, secure), {
      rejectUnauthorized: false
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("Timed out connecting to TV"));
      }, DEFAULT_TIMEOUT_MS);

      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    socket.on("message", (buffer) => this.#handleMessage(buffer.toString("utf8")));
    socket.on("close", () => this.#handleClose());
    socket.on("error", (error) => this.#handleSocketError(error));

    this.socket = socket;

    const registerPayload = structuredClone(REGISTER_PAYLOAD);
    if (this.clientKey) {
      registerPayload.payload["client-key"] = this.clientKey;
    }

    const registration = await this.#sendInternal(registerPayload, DEFAULT_TIMEOUT_MS);
    if (registration?.payload?.["client-key"]) {
      this.saveClientKey(registration.payload["client-key"]);
    }
    if (registration?.type === "response" && registration?.payload?.pairingType) {
      throw new Error("TV requires pairing approval on screen");
    }

    this.status = "connected";
    this.tv.connection = secure ? "wss" : "ws";
    this.emit("status", this.status);
  }

  #handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);
    if (message.type === "registered" && message.payload?.["client-key"]) {
      this.saveClientKey(message.payload["client-key"]);
      this.status = "connected";
      this.emit("status", this.status);
    }
    const pending = this.pending.get(message.id);
    if (pending) {
      if (message.type === "error") {
        pending.reject(new Error(message.error || "TV returned an error"));
      } else {
        pending.resolve(message);
      }
      this.pending.delete(message.id);
    }
    this.emit("message", message);
  }

  #handleClose() {
    this.status = "disconnected";
    this.pointerSocket?.close();
    this.pointerSocket = null;
    this.emit("status", this.status);
  }

  #handleSocketError(error) {
    this.lastError = error.message;
    this.emit("error", error);
  }

  async #sendInternal(message, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = message.id || `req-${++this.requestId}`;
    const envelope = { ...message, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out for ${message.uri || message.type}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });

      this.socket.send(JSON.stringify(envelope), (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async request({ uri, payload = {}, type = "request", timeoutMs = DEFAULT_TIMEOUT_MS }) {
    await this.connect();
    return this.#sendInternal({ type, uri, payload }, timeoutMs);
  }

  async button(name) {
    return this.request({
      uri: "ssap://com.webos.service.ime/sendEnterKey",
      payload: { buttonName: name }
    });
  }

  async sendRemoteButton(name) {
    const pointer = await this.pointer();
    pointer.send(`type:button\nname:${name}\n\n`);
  }

  async sendText(text, replace = true) {
    return this.request({
      uri: "ssap://com.webos.service.ime/insertText",
      payload: { text, replace }
    });
  }

  async pointer() {
    await this.connect();
    if (this.pointerSocket?.readyState === WebSocket.OPEN) {
      return this.pointerSocket;
    }
    if (this.pointerReady) {
      return this.pointerReady;
    }

    this.pointerReady = (async () => {
      const response = await this.request({
        uri: "ssap://com.webos.service.networkinput/getPointerInputSocket"
      });
      const pointerSocket = new WebSocket(response.payload.socketPath, {
        rejectUnauthorized: false
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pointerSocket.terminate();
          reject(new Error("Timed out opening pointer input socket"));
        }, DEFAULT_TIMEOUT_MS);
        pointerSocket.once("open", () => {
          clearTimeout(timer);
          resolve();
        });
        pointerSocket.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      this.pointerSocket = pointerSocket;
      pointerSocket.on("close", () => {
        this.pointerSocket = null;
      });
      return pointerSocket;
    })();

    try {
      return await this.pointerReady;
    } finally {
      this.pointerReady = null;
    }
  }

  async pointerMove(dx, dy, drag = 0) {
    const pointer = await this.pointer();
    pointer.send(`type:move\ndx:${dx}\ndy:${dy}\ndown:${drag}\n\n`);
  }

  async scroll(dx, dy) {
    const pointer = await this.pointer();
    pointer.send(`type:scroll\ndx:${dx}\ndy:${dy}\n\n`);
  }

  async getDashboard() {
    const endpoints = {
      systemInfo: "ssap://system/getSystemInfo",
      softwareInfo: "ssap://com.webos.service.update/getCurrentSWInformation",
      audio: "ssap://audio/getVolume",
      foregroundApp: "ssap://com.webos.applicationManager/getForegroundAppInfo",
      apps: "ssap://com.webos.applicationManager/listApps",
      channels: "ssap://tv/getChannelList",
      currentChannel: "ssap://tv/getCurrentChannel",
      inputs: "ssap://tv/getExternalInputList",
      settings: "ssap://settings/getSystemSettings"
    };

    const entries = await Promise.all(
      Object.entries(endpoints).map(async ([key, uri]) => {
        try {
          const response = await this.request({
            uri,
            payload: key === "settings" ? { category: "picture", keys: [] } : {}
          });
          return [key, response.payload];
        } catch (error) {
          return [key, { error: error.message }];
        }
      })
    );

    return Object.fromEntries(entries);
  }
}
