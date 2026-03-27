import dgram from "node:dgram";
import { XMLParser } from "fast-xml-parser";

const DISCOVERY_TARGET = "urn:lge-com:service:webos-second-screen:1";
const SSDP_HOST = "239.255.255.250";
const SSDP_PORT = 1900;
const REQUEST_TIMEOUT_MS = Number(process.env.DISCOVERY_TIMEOUT_MS || 3500);
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
      return normalizeTvRecord(headers, description);
    })
  );

  return tvs
    .filter((tv) => {
      const text = `${tv.serviceTarget} ${tv.server} ${tv.manufacturer} ${tv.modelName} ${tv.name}`.toLowerCase();
      return text.includes("lge") || text.includes("lg") || text.includes("webos");
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
