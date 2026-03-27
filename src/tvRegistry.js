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

  client(id) {
    const tv = this.get(id);
    if (!this.clients.has(id)) {
      this.clients.set(id, new LgTvClient(tv, this.store));
    }
    return this.clients.get(id);
  }
}
