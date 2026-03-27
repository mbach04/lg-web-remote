import dgram from "node:dgram";
import os from "node:os";
import { XMLParser } from "fast-xml-parser";

const DISCOVERY_TARGET = "urn:lge-com:service:webos-second-screen:1";
const SSDP_HOST = "239.255.255.250";
const SSDP_PORT = 1900;
const REQUEST_TIMEOUT_MS = Number(process.env.DISCOVERY_TIMEOUT_MS || 3500);
const ACTIVE_SCAN_TIMEOUT_MS = Number(process.env.ACTIVE_SCAN_TIMEOUT_MS || 450);
const ACTIVE_SCAN_CONCURRENCY = Number(process.env.ACTIVE_SCAN_CONCURRENCY || 24);
const ACTIVE_SCAN_DESCRIPTION_PATHS = [
  "/ssdp/device-desc.xml",
  "/description.xml",
  "/"
];
const SEARCH_TARGETS = [
  DISCOVERY_TARGET,
  "upnp:rootdevice",
  "ssdp:all"
];
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true
});

function parseHeaders(message) {
  const [firstLine, ...lines] = message.split("\r\n");
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[key] = value;
  }
  return { firstLine, headers };
}

async function fetchDescription(location) {
  try {
    const response = await fetch(location);
    if (!response.ok) {
      return {};
    }
    const body = await response.text();
    const parsed = xmlParser.parse(body);
    const device = parsed?.root?.device ?? {};
    return {
      friendlyName: device.friendlyName,
      manufacturer: device.manufacturer,
      modelName: device.modelName,
      modelNumber: device.modelNumber,
      serialNumber: device.serialNumber,
      udn: device.UDN
    };
  } catch (error) {
    return {};
  }
}

function normalizeTvRecord(headers, description) {
  const location = headers.location;
  const url = new URL(location);
  const usn = headers.usn || description.udn || url.hostname;
  return {
    id: usn.replace(/^uuid:/i, ""),
    ip: url.hostname,
    port: 3000,
    securePort: 3001,
    descriptionUrl: location,
    serviceTarget: headers.st || DISCOVERY_TARGET,
    server: headers.server,
    name: description.friendlyName || headers["x-friendly-name"] || url.hostname,
    modelName: description.modelName || "Unknown model",
    modelNumber: description.modelNumber || "Unknown",
    manufacturer: description.manufacturer || "LG",
    serialNumber: description.serialNumber || null,
    lastSeenAt: new Date().toISOString()
  };
}

function looksLikeLgTv(headers, description) {
  const location = headers.location || "";
  const server = headers.server || "";
  const serviceTarget = headers.st || "";
  const usn = headers.usn || "";
  const text = [
    location,
    server,
    serviceTarget,
    usn,
    description.manufacturer,
    description.modelName,
    description.friendlyName
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("webos") || text.includes("lge") || text.includes("lg smart tv")) {
    return true;
  }

  try {
    const url = new URL(location);
    if (url.port === "3000" || url.port === "3001") {
      return true;
    }
  } catch (_error) {
    return false;
  }

  return false;
}

function buildSearchRequest(target) {
  return [
    "M-SEARCH * HTTP/1.1",
    `HOST: ${SSDP_HOST}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    "MX: 3",
    `ST: ${target}`,
    "",
    ""
  ].join("\r\n");
}

function privateIpv4Bases() {
  const interfaces = os.networkInterfaces();
  const bases = new Set();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }
      const octets = address.address.split(".");
      if (octets.length !== 4) {
        continue;
      }
      bases.add(`${octets[0]}.${octets[1]}.${octets[2]}`);
    }
  }

  return [...bases];
}

async function fetchDescriptionFromHost(host) {
  for (const path of ACTIVE_SCAN_DESCRIPTION_PATHS) {
    try {
      const response = await fetch(`http://${host}:3000${path}`, {
        signal: AbortSignal.timeout(ACTIVE_SCAN_TIMEOUT_MS)
      });
      if (!response.ok) {
        continue;
      }
      const body = await response.text();
      const parsed = xmlParser.parse(body);
      const device = parsed?.root?.device ?? {};
      if (!device?.modelName && !device?.friendlyName && !device?.manufacturer) {
        continue;
      }
      return {
        friendlyName: device.friendlyName,
        manufacturer: device.manufacturer,
        modelName: device.modelName,
        modelNumber: device.modelNumber,
        serialNumber: device.serialNumber,
        udn: device.UDN,
        location: `http://${host}:3000${path}`
      };
    } catch (_error) {
      continue;
    }
  }

  return null;
}

async function activeSubnetScan() {
  const results = [];
  const bases = privateIpv4Bases();
  const candidates = [];

  for (const base of bases) {
    for (let suffix = 1; suffix <= 254; suffix += 1) {
      candidates.push(`${base}.${suffix}`);
    }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const host = candidates[cursor];
      cursor += 1;
      const description = await fetchDescriptionFromHost(host);
      if (!description) {
        continue;
      }
      const headers = {
        location: description.location,
        usn: description.udn || host,
        st: DISCOVERY_TARGET,
        server: "active-scan"
      };
      if (looksLikeLgTv(headers, description)) {
        results.push(normalizeTvRecord(headers, description));
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, ACTIVE_SCAN_CONCURRENCY) }, () => worker())
  );

  const deduped = new Map();
  for (const tv of results) {
    deduped.set(tv.ip, tv);
  }
  return [...deduped.values()];
}

export async function discoverTvs(timeoutMs = REQUEST_TIMEOUT_MS) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const discovered = new Map();

  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, () => {
      socket.removeListener("error", reject);
      resolve();
    });
  });

  socket.on("message", (buffer) => {
    const message = buffer.toString("utf8");
    const { firstLine, headers } = parseHeaders(message);
    if (!firstLine?.includes("200 OK") || !headers.location) {
      return;
    }
    discovered.set(headers.location, headers);
  });

  for (const target of SEARCH_TARGETS) {
    const searchRequest = buildSearchRequest(target);
    socket.send(Buffer.from(searchRequest), SSDP_PORT, SSDP_HOST);
  }

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  socket.close();

  const tvs = await Promise.all(
    [...discovered.values()].map(async (headers) => {
      const description = await fetchDescription(headers.location);
      if (!looksLikeLgTv(headers, description)) {
        return null;
      }
      return normalizeTvRecord(headers, description);
    })
  );

  const passiveResults = tvs.filter(Boolean);
  if (passiveResults.length > 0) {
    return passiveResults.sort((left, right) => left.name.localeCompare(right.name));
  }

  const activeResults = await activeSubnetScan();
  return activeResults.sort((left, right) => left.name.localeCompare(right.name));
}
