import EventEmitter from "node:events";
import WebSocket from "ws";

const REGISTER_PAYLOAD = {
  type: "register",
  payload: {
    forcePairing: false,
    pairingType: "PROMPT",
    manifest: {
      manifestVersion: 1,
      appVersion: "1.1",
      signed: {
        created: "20140509",
        appId: "com.lge.test",
        vendorId: "com.lge",
        localizedAppNames: {
          "": "LG Remote App",
          "ko-KR": "리모컨 앱",
          "zxx-XX": "LG Remote App"
        },
        localizedVendorNames: {
          "": "LG Electronics"
        },
        permissions: [
          "TEST_SECURE",
          "CONTROL_INPUT_TEXT",
          "CONTROL_MOUSE_AND_KEYBOARD",
          "READ_INSTALLED_APPS",
          "READ_LGE_SDX",
          "READ_NOTIFICATIONS",
          "SEARCH",
          "WRITE_SETTINGS",
          "WRITE_NOTIFICATION_ALERT",
          "CONTROL_POWER",
          "READ_CURRENT_CHANNEL",
          "READ_RUNNING_APPS",
          "READ_UPDATE_INFO",
          "UPDATE_FROM_REMOTE_APP",
          "READ_LGE_TV_INPUT_EVENTS",
          "READ_TV_CURRENT_TIME"
        ],
        serial: "2f930e2d2cfe083771f68e4fe7bb07"
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
        "CONTROL_INPUT_MEDIA_RECORDING",
        "CONTROL_INPUT_MEDIA_PLAYBACK",
        "CONTROL_INPUT_TV",
        "CONTROL_POWER",
        "READ_APP_STATUS",
        "READ_CURRENT_CHANNEL",
        "READ_INPUT_DEVICE_LIST",
        "READ_NETWORK_STATE",
        "READ_RUNNING_APPS",
        "READ_TV_CHANNEL_LIST",
        "WRITE_NOTIFICATION_TOAST",
        "READ_POWER_STATE",
        "READ_COUNTRY_INFO",
        "READ_SETTINGS",
        "CONTROL_TV_SCREEN",
        "CONTROL_TV_STANBY",
        "CONTROL_FAVORITE_GROUP",
        "CONTROL_USER_INFO",
        "CHECK_BLUETOOTH_DEVICE",
        "CONTROL_BLUETOOTH",
        "CONTROL_TIMER_INFO",
        "STB_INTERNAL_CONNECTION",
        "CONTROL_RECORDING",
        "READ_RECORDING_STATE",
        "WRITE_RECORDING_LIST",
        "READ_RECORDING_LIST",
        "READ_RECORDING_SCHEDULE",
        "WRITE_RECORDING_SCHEDULE",
        "READ_STORAGE_DEVICE_LIST",
        "READ_TV_PROGRAM_INFO",
        "CONTROL_BOX_CHANNEL",
        "READ_TV_ACR_AUTH_TOKEN",
        "READ_TV_CONTENT_STATE",
        "READ_TV_CURRENT_TIME",
        "ADD_LAUNCHER_CHANNEL",
        "SET_CHANNEL_SKIP",
        "RELEASE_CHANNEL_SKIP",
        "CONTROL_CHANNEL_BLOCK",
        "DELETE_SELECT_CHANNEL",
        "CONTROL_CHANNEL_GROUP",
        "SCAN_TV_CHANNELS",
        "CONTROL_TV_POWER",
        "CONTROL_WOL"
      ],
      signatures: [
        {
          signatureVersion: 1,
          signature:
            "eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw=="
        }
      ]
    }
  }
};

const DEFAULT_TIMEOUT_MS = 8000;
const REGISTER_TIMEOUT_MS = Number(process.env.REGISTER_TIMEOUT_MS || 60000);

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
    this.registrationReady = null;
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

    this.registrationReady = this.#waitForRegistration();
    this.socket.send(JSON.stringify(registerPayload));
    await this.registrationReady;

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
    this.registrationReady = null;
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

  #waitForRegistration(timeoutMs = REGISTER_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for TV registration approval"));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.off("message", handleMessage);
        this.off("error", handleError);
        this.off("status", handleStatus);
      };

      const handleMessage = (message) => {
        if (message.type === "registered") {
          cleanup();
          resolve(message);
          return;
        }

        if (message.type === "error") {
          cleanup();
          reject(new Error(message.error || "Registration failed"));
          return;
        }

        if (message.type === "response" && message.payload?.pairingType) {
          this.status = "pairing";
          this.emit("status", this.status);
        }
      };

      const handleError = (error) => {
        cleanup();
        reject(error);
      };

      const handleStatus = (status) => {
        if (status === "disconnected") {
          cleanup();
          reject(new Error("TV disconnected before registration completed"));
        }
      };

      this.on("message", handleMessage);
      this.on("error", handleError);
      this.on("status", handleStatus);
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
    const normalized = String(name || "").toUpperCase();
    const directRequests = {
      PLAY: { uri: "ssap://media.controls/play" },
      PAUSE: { uri: "ssap://media.controls/pause" },
      STOP: { uri: "ssap://media.controls/stop" },
      REWIND: { uri: "ssap://media.controls/rewind" },
      FASTFORWARD: { uri: "ssap://media.controls/fastForward" },
      VOLUMEUP: { uri: "ssap://audio/volumeUp" },
      VOLUMEDOWN: { uri: "ssap://audio/volumeDown" },
      CHANNELUP: { uri: "ssap://tv/channelUp" },
      CHANNELDOWN: { uri: "ssap://tv/channelDown" }
    };

    if (normalized === "MUTE") {
      const volume = await this.request({ uri: "ssap://audio/getVolume" });
      return this.request({
        uri: "ssap://audio/setMute",
        payload: { mute: !Boolean(volume?.payload?.muted) }
      });
    }

    if (normalized === "ENTER") {
      const pointer = await this.pointer();
      pointer.send("type:click\n\n");
      return;
    }

    const directRequest = directRequests[normalized];
    if (directRequest) {
      return this.request(directRequest);
    }

    const pointer = await this.pointer();
    pointer.send(`type:button\nname:${normalized}\n\n`);
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
