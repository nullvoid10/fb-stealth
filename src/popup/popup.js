const SETTINGS_KEY = "fbpgSettings";
const counterHelpers = window.FBPG_COUNTERS;
const DEFAULT_SETTINGS = {
  blockSeen: true,
  blockStorySeen: false,
  blockTyping: true,
  debugMode: false
};

const controls = {
  blockSeen: document.getElementById("blockSeen"),
  blockStorySeen: document.getElementById("blockStorySeen"),
  blockTyping: document.getElementById("blockTyping"),
  debugMode: document.getElementById("debugMode"),
  tabPaused: document.getElementById("tabPaused")
};

const tabStatus = document.getElementById("tabStatus");
const statsElements = {
  todayMessengerSeen: document.getElementById("todayMessengerSeenCount"),
  sinceMessengerSeen: document.getElementById("sinceMessengerSeenCount"),
  todayStorySeen: document.getElementById("todayStorySeenCount"),
  sinceStorySeen: document.getElementById("sinceStorySeenCount"),
  todayTyping: document.getElementById("todayTypingCount"),
  sinceTyping: document.getElementById("sinceTypingCount"),
  todayTotal: document.getElementById("todayTotalCount"),
  sinceTotal: document.getElementById("sinceTotalCount"),
  lastBlocked: document.getElementById("lastBlockedText"),
  status: document.getElementById("counterStatus")
};
const resetCounters = document.getElementById("resetCounters");
const optionsButton = document.getElementById("optionsButton");

let activeTab = null;
let settings = { ...DEFAULT_SETTINGS };
let statusTimer = null;

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await chrome.runtime.sendMessage({
    type: "FBPG_GET_POPUP_STATE",
    tabId: activeTab && activeTab.id
  });

  settings = {
    ...DEFAULT_SETTINGS,
    ...(state && state.settings ? state.settings : {})
  };

  applySettingsToControls();
  controls.tabPaused.checked = Boolean(state && state.tabPaused);
  renderCounters((state && state.counters) || {});
  renderTabStatus();

  for (const key of ["blockSeen", "blockStorySeen", "blockTyping", "debugMode"]) {
    controls[key].addEventListener("change", () => updateSetting(key, controls[key].checked));
  }

  controls.tabPaused.addEventListener("change", updateTabPaused);
  resetCounters.addEventListener("click", resetDebugCounters);
  optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
}

function applySettingsToControls() {
  controls.blockSeen.checked = settings.blockSeen;
  controls.blockStorySeen.checked = settings.blockStorySeen;
  controls.blockTyping.checked = settings.blockTyping;
  controls.debugMode.checked = settings.debugMode;
}

async function updateSetting(key, value) {
  const previousValue = Boolean(settings[key]);
  settings = {
    ...settings,
    [key]: value
  };

  const response = await chrome.runtime.sendMessage({
    type: "FBPG_SAVE_SETTINGS",
    settings
  });
  if (response && response.ok && response.settings) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...response.settings
    };
  } else {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  }
  await applySettingsToActiveTab();
  applySettingsToControls();
  renderTabStatus();

  if ((key === "blockSeen" || key === "blockStorySeen") && previousValue !== Boolean(value)) {
    await reloadActiveFacebookTab();
  }
}

async function applySettingsToActiveTab() {
  if (!activeTab || !activeTab.id || !isFacebookUrl(activeTab.url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: "FBPG_APPLY_SETTINGS",
      settings
    });
  } catch (_error) {
    // The storage listener will apply settings when the content script is available.
  }
}

async function reloadActiveFacebookTab() {
  if (!activeTab || !activeTab.id || !isFacebookUrl(activeTab.url)) {
    return;
  }

  try {
    await chrome.tabs.reload(activeTab.id);
  } catch (_error) {
    // Reload is only a state reset; settings are already saved.
  }
}

async function updateTabPaused() {
  const paused = controls.tabPaused.checked;

  if (!activeTab || !activeTab.id || !isFacebookUrl(activeTab.url)) {
    controls.tabPaused.checked = false;
    tabStatus.textContent = "Open Facebook or Messenger first";
    return;
  }

  await chrome.runtime.sendMessage({
    type: "FBPG_SET_TAB_PAUSED",
    tabId: activeTab.id,
    paused
  });

  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: "FBPG_SET_TAB_PAUSED",
      paused
    });
  } catch (_error) {
    // Ignore tabs where the content script is not available yet.
  }

  renderTabStatus();
}

function renderTabStatus() {
  if (!activeTab || !isFacebookUrl(activeTab.url)) {
    tabStatus.textContent = "Not on Facebook";
    return;
  }

  if (controls.tabPaused.checked) {
    tabStatus.textContent = "Paused on this tab";
    return;
  }

  tabStatus.textContent = settings.blockStorySeen ? "Active - story blocking experimental" : "Active on this tab";
}

function isFacebookUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const { hostname } = new URL(url);
    return hostname.endsWith("facebook.com") || hostname.endsWith("messenger.com");
  } catch (_error) {
    return false;
  }
}

function renderCounters(counters) {
  const state = counterHelpers.normalizeCounterState(counters);

  statsElements.todayMessengerSeen.textContent = String(state.today.messengerSeen);
  statsElements.sinceMessengerSeen.textContent = String(state.sinceReset.messengerSeen);
  statsElements.todayStorySeen.textContent = String(state.today.storySeen);
  statsElements.sinceStorySeen.textContent = String(state.sinceReset.storySeen);
  statsElements.todayTyping.textContent = String(state.today.typing);
  statsElements.sinceTyping.textContent = String(state.sinceReset.typing);
  statsElements.todayTotal.textContent = String(state.today.total);
  statsElements.sinceTotal.textContent = String(state.sinceReset.total);
  statsElements.lastBlocked.textContent = `Last blocked: ${counterHelpers.formatRelativeTime(state.lastBlockedAt)}`;
}

async function resetDebugCounters() {
  const response = await chrome.runtime.sendMessage({ type: "FBPG_RESET_COUNTERS" });
  if (!response || !response.ok || !response.counters) {
    showCounterStatus("Reset failed", true);
    return;
  }

  renderCounters(response.counters);
  showCounterStatus("Stats reset");
}

function showCounterStatus(message, isError = false) {
  statsElements.status.textContent = message;
  statsElements.status.classList.toggle("is-error", isError);
  if (statusTimer) {
    clearTimeout(statusTimer);
  }
  statusTimer = setTimeout(() => {
    statsElements.status.textContent = "";
    statsElements.status.classList.remove("is-error");
    statusTimer = null;
  }, 1400);
}
