const state = {
  tvs: [],
  selectedTvId: null,
  dashboard: null,
  config: null
};

const elements = {
  tvList: document.querySelector("#tv-list"),
  tvCount: document.querySelector("#tv-count"),
  scanButton: document.querySelector("#scan-button"),
  refreshButton: document.querySelector("#refresh-button"),
  statusLine: document.querySelector("#status-line"),
  manualAddForm: document.querySelector("#manual-add-form"),
  manualHost: document.querySelector("#manual-host"),
  manualName: document.querySelector("#manual-name"),
  emptyState: document.querySelector("#empty-state"),
  tvDetail: document.querySelector("#tv-detail"),
  tvName: document.querySelector("#tv-name"),
  tvModel: document.querySelector("#tv-model"),
  tvMeta: document.querySelector("#tv-meta"),
  connectButton: document.querySelector("#connect-button"),
  powerButton: document.querySelector("#power-button"),
  foregroundApp: document.querySelector("#foreground-app"),
  volume: document.querySelector("#volume"),
  channel: document.querySelector("#channel"),
  connection: document.querySelector("#connection"),
  remoteButtons: document.querySelector("#remote-buttons"),
  touchpad: document.querySelector("#touchpad"),
  appsList: document.querySelector("#apps-list"),
  inputsList: document.querySelector("#inputs-list"),
  channelsList: document.querySelector("#channels-list"),
  textForm: document.querySelector("#text-form"),
  textInput: document.querySelector("#text-input"),
  apiForm: document.querySelector("#api-form"),
  apiUri: document.querySelector("#api-uri"),
  apiType: document.querySelector("#api-type"),
  apiPayload: document.querySelector("#api-payload"),
  apiResponse: document.querySelector("#api-response"),
  toast: document.querySelector("#toast")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  elements.toast.style.borderColor = isError ? "rgba(233, 122, 108, 0.5)" : "rgba(116, 211, 174, 0.4)";
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.add("hidden"), 3200);
}

function setStatus(message) {
  elements.statusLine.textContent = message;
}

function selectedTv() {
  return state.tvs.find((tv) => tv.id === state.selectedTvId) || null;
}

function renderRemoteButtons() {
  elements.remoteButtons.innerHTML = "";
  for (const buttonName of state.config.remoteButtons) {
    const button = document.createElement("button");
    button.textContent = buttonName;
    button.addEventListener("click", () => postButton(buttonName));
    elements.remoteButtons.appendChild(button);
  }
}

function renderTvList() {
  elements.tvCount.textContent = String(state.tvs.length);
  elements.tvList.innerHTML = "";
  for (const tv of state.tvs) {
    const card = document.createElement("button");
    card.className = `tv-card ${tv.id === state.selectedTvId ? "selected" : ""}`;
    card.innerHTML = `
      <div class="eyebrow">${tv.modelName}</div>
      <div><strong>${tv.name}</strong></div>
      <div class="meta">${tv.ip} • ${tv.modelNumber}</div>
    `;
    card.addEventListener("click", async () => {
      state.selectedTvId = tv.id;
      renderTvList();
      await refreshDashboard();
    });
    elements.tvList.appendChild(card);
  }
}

function renderDataList(container, items, labelKey, actionLabel, onClick) {
  container.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<div class="meta">No data available</div>`;
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "data-item";
    const label = document.createElement("div");
    label.innerHTML = `<strong>${item[labelKey] || item.id || "Unnamed"}</strong><div class="meta">${item.appId || item.id || ""}</div>`;
    row.appendChild(label);
    if (actionLabel) {
      const button = document.createElement("button");
      button.textContent = actionLabel;
      button.addEventListener("click", () => onClick(item));
      row.appendChild(button);
    }
    container.appendChild(row);
  }
}

function renderDashboard() {
  const tv = selectedTv();
  if (!tv) {
    elements.emptyState.classList.remove("hidden");
    elements.tvDetail.classList.add("hidden");
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.tvDetail.classList.remove("hidden");
  elements.tvName.textContent = tv.name;
  elements.tvModel.textContent = `${tv.manufacturer} ${tv.modelName}`;
  elements.tvMeta.textContent = `${tv.ip} • ${tv.modelNumber} • ${tv.descriptionUrl}`;
  elements.connection.textContent = tv.connection || "Not connected";

  const dashboard = state.dashboard || {};
  elements.foregroundApp.textContent = dashboard.foregroundApp?.appId || "-";
  elements.volume.textContent = dashboard.audio?.volumeStatus
    ? `${dashboard.audio.volumeStatus.volume}${dashboard.audio.volumeStatus.mute ? " (muted)" : ""}`
    : dashboard.audio?.volume ?? "-";
  elements.channel.textContent = dashboard.currentChannel?.channelName || dashboard.currentChannel?.channelNumber || "-";

  renderDataList(
    elements.appsList,
    dashboard.apps?.apps || dashboard.apps,
    "title",
    "Launch",
    (app) => sendRequest("ssap://system.launcher/launch", { id: app.id })
  );
  renderDataList(
    elements.inputsList,
    dashboard.inputs?.devices || dashboard.inputs,
    "label",
    "Switch",
    (input) => sendRequest("ssap://tv/switchInput", { inputId: input.id })
  );
  renderDataList(
    elements.channelsList,
    dashboard.channels?.channelList || dashboard.channels,
    "channelName",
    "Tune",
    (channel) => sendRequest("ssap://tv/openChannel", { channelId: channel.channelId })
  );
}

async function loadConfig() {
  state.config = await api("/api/config");
  renderRemoteButtons();
}

async function scanTvs() {
  elements.scanButton.disabled = true;
  setStatus("Scanning the local network for LG TVs...");
  try {
    state.tvs = await api("/api/discovery/scan", { method: "POST", body: "{}" });
    if (!state.selectedTvId && state.tvs[0]) {
      state.selectedTvId = state.tvs[0].id;
    }
    renderTvList();
    await refreshDashboard();
    setStatus(
      state.tvs.length
        ? `Discovery finished. Found ${state.tvs.length} TV${state.tvs.length === 1 ? "" : "s"}.`
        : "Discovery finished, but no TVs replied. If you're using Podman, add a TV manually by IP to keep testing."
    );
    showToast(`Discovered ${state.tvs.length} TV${state.tvs.length === 1 ? "" : "s"}`);
  } catch (error) {
    setStatus(`Discovery failed: ${error.message}`);
    showToast(error.message, true);
  } finally {
    elements.scanButton.disabled = false;
  }
}

async function refreshDashboard() {
  const tv = selectedTv();
  renderDashboard();
  if (!tv) {
    setStatus("Select a TV first, or add one manually by IP.");
    showToast("Select a TV first, or add one manually by IP.", true);
    return;
  }
  setStatus(`Refreshing status from ${tv.name}...`);
  try {
    state.dashboard = await api(`/api/tvs/${tv.id}/dashboard`);
    setStatus(`Connected to ${tv.name}.`);
  } catch (error) {
    state.dashboard = null;
    setStatus(`Refresh failed for ${tv.name}: ${error.message}`);
    showToast(error.message, true);
  }
  renderDashboard();
}

async function connectSelectedTv() {
  const tv = selectedTv();
  if (!tv) {
    return;
  }
  try {
    await api(`/api/tvs/${tv.id}/connect`, { method: "POST", body: "{}" });
    setStatus(`Pairing with ${tv.name}. Check the TV screen for an approval prompt if needed.`);
    showToast(`Connected to ${tv.name}. Approve pairing on the TV if prompted.`);
    await refreshDashboard();
  } catch (error) {
    setStatus(`Connection failed for ${tv.name}: ${error.message}`);
    showToast(error.message, true);
  }
}

async function sendRequest(uri, payload = {}, type = "request") {
  const tv = selectedTv();
  if (!tv) {
    throw new Error("No TV selected");
  }
  const result = await api(`/api/tvs/${tv.id}/request`, {
    method: "POST",
    body: JSON.stringify({ uri, payload, type })
  });
  elements.apiResponse.textContent = JSON.stringify(result, null, 2);
  await refreshDashboard();
  return result;
}

async function postButton(name) {
  const tv = selectedTv();
  if (!tv) {
    return;
  }
  try {
    await api(`/api/tvs/${tv.id}/button`, {
      method: "POST",
      body: JSON.stringify({ name })
    });
  } catch (error) {
    showToast(error.message, true);
  }
}

function bindQuickActions() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-action");
      try {
        if (action === "volume-up") {
          await postButton("VOLUMEUP");
        } else if (action === "volume-down") {
          await postButton("VOLUMEDOWN");
        } else if (action === "mute") {
          await postButton("MUTE");
        } else if (action === "channel-up") {
          await postButton("CHANNELUP");
        } else if (action === "channel-down") {
          await postButton("CHANNELDOWN");
        } else if (action === "home") {
          await postButton("HOME");
        } else if (action === "back") {
          await postButton("BACK");
        } else if (action === "toast") {
          await sendRequest("ssap://system.notifications/createToast", {
            message: "Hello from LG TV Control Hub"
          });
        }
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });
}

function bindTouchpad() {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  elements.touchpad.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    elements.touchpad.setPointerCapture(event.pointerId);
  });

  elements.touchpad.addEventListener("pointermove", async (event) => {
    if (!dragging) {
      return;
    }
    const dx = Math.round((event.clientX - lastX) * 1.8);
    const dy = Math.round((event.clientY - lastY) * 1.8);
    lastX = event.clientX;
    lastY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) < 2) {
      return;
    }
    try {
      const tv = selectedTv();
      if (!tv) {
        return;
      }
      await api(`/api/tvs/${tv.id}/pointer/move`, {
        method: "POST",
        body: JSON.stringify({ dx, dy })
      });
    } catch (error) {
      showToast(error.message, true);
      dragging = false;
    }
  });

  elements.touchpad.addEventListener("pointerup", () => {
    dragging = false;
  });

  document.querySelectorAll(".scroll-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const tv = selectedTv();
      if (!tv) {
        return;
      }
      try {
        await api(`/api/tvs/${tv.id}/pointer/scroll`, {
          method: "POST",
          body: JSON.stringify({ dx: 0, dy: Number(button.dataset.scroll) })
        });
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });
}

function bindReloadButtons() {
  document.querySelectorAll("[data-fetch]").forEach((button) => {
    button.addEventListener("click", refreshDashboard);
  });
}

function bindForms() {
  elements.manualAddForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const tv = await api("/api/tvs/manual", {
        method: "POST",
        body: JSON.stringify({
          host: elements.manualHost.value,
          name: elements.manualName.value
        })
      });
      state.tvs = await api("/api/tvs");
      state.selectedTvId = tv.id;
      renderTvList();
      setStatus(`Added ${tv.name}. You can pair with it now.`);
      showToast(`Added ${tv.name}`);
      elements.manualHost.value = "";
      elements.manualName.value = "";
      await refreshDashboard();
    } catch (error) {
      setStatus(`Manual add failed: ${error.message}`);
      showToast(error.message, true);
    }
  });

  elements.textForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tv = selectedTv();
    if (!tv) {
      return;
    }
    try {
      await api(`/api/tvs/${tv.id}/text`, {
        method: "POST",
        body: JSON.stringify({ text: elements.textInput.value, replace: true })
      });
      showToast("Text sent");
      elements.textInput.value = "";
    } catch (error) {
      showToast(error.message, true);
    }
  });

  elements.apiForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = JSON.parse(elements.apiPayload.value || "{}");
      const result = await sendRequest(elements.apiUri.value, payload, elements.apiType.value);
      elements.apiResponse.textContent = JSON.stringify(result, null, 2);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

elements.scanButton.addEventListener("click", scanTvs);
elements.refreshButton.addEventListener("click", refreshDashboard);
elements.connectButton.addEventListener("click", connectSelectedTv);
elements.powerButton.addEventListener("click", async () => {
  try {
    await sendRequest("ssap://system/turnOff", {});
  } catch (error) {
    showToast(error.message, true);
  }
});

await loadConfig();
bindQuickActions();
bindTouchpad();
bindReloadButtons();
bindForms();
setStatus("Loading saved TV list...");

state.tvs = await api("/api/tvs");
if (state.tvs[0]) {
  state.selectedTvId = state.tvs[0].id;
}
renderTvList();
await refreshDashboard();
