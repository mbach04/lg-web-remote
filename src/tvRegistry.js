import { discoverTvs } from "./lgDiscovery.js";
import { LgTvClient } from "./lgTvClient.js";

export class TvRegistry {
  constructor(store) {
    this.store = store;
    this.tvs = new Map();
    this.clients = new Map();
  }

  async scan() {
    const discovered = await discoverTvs();
    for (const tv of discovered) {
      const existing = this.tvs.get(tv.id);
      this.tvs.set(tv.id, { ...existing, ...tv });
    }
    return this.list();
  }

  list() {
    return [...this.tvs.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  get(id) {
    const tv = this.tvs.get(id);
    if (!tv) {
      throw new Error(`Unknown TV: ${id}`);
    }
    return tv;
  }

  upsert(tv) {
    const existing = this.tvs.get(tv.id);
    this.tvs.set(tv.id, { ...existing, ...tv });
    return this.get(tv.id);
  }

  addManual(host, name = null) {
    const normalizedHost = String(host || "").trim();
    if (!normalizedHost) {
      throw new Error("A TV IP address or hostname is required");
    }
    const id = `manual-${normalizedHost}`;
    return this.upsert({
      id,
      ip: normalizedHost,
      port: 3000,
      securePort: 3001,
      descriptionUrl: `http://${normalizedHost}:3000/`,
      serviceTarget: "manual",
      server: null,
      name: name?.trim() || normalizedHost,
      modelName: "Manual entry",
      modelNumber: "Unknown",
      manufacturer: "LG",
      serialNumber: null,
      lastSeenAt: new Date().toISOString(),
      discoveryMode: "manual"
    });
  }

  client(id) {
    const tv = this.get(id);
    if (!this.clients.has(id)) {
      this.clients.set(id, new LgTvClient(tv, this.store));
    }
    return this.clients.get(id);
  }
}
