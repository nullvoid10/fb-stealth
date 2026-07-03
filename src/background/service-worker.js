importScripts("../shared/counters.js");

const SETTINGS_KEY = "fbpgSettings";
const PAUSED_TABS_KEY = "fbpgPausedTabs";
const COUNTERS_KEY = "fbpgCounters";

const DEFAULT_SETTINGS = {
  blockSeen: true,
  blockStorySeen: false,
  blockTyping: true,
  debugMode: false
};
const SETTINGS_SCHEMA_VERSION = 8;

const counterHelpers = globalThis.FBPG_COUNTERS;

let counterWriteQueue = Promise.resolve();

bootstrap();

chrome.runtime.onInstalled.addListener(async () => {
  await migrateSettings();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateSettings();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await setTabPaused(tabId, false);
});

async function bootstrap() {
  await migrateSettings();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "FBPG_GET_TAB_PAUSE") {
    getPausedTabs()
      .then((pausedTabs) => sendResponse({ paused: Boolean(sender.tab && pausedTabs[String(sender.tab.id)]) }))
      .catch((error) => sendResponse({ paused: false, error: error.message }));
    return true;
  }

  if (message.type === "FBPG_GET_POPUP_STATE") {
    getPopupState(message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "FBPG_SET_TAB_PAUSED") {
    setTabPaused(message.tabId, Boolean(message.paused))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "FBPG_SAVE_SETTINGS") {
    saveSettings(message.settings)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "FBPG_RECORD_BLOCKED_EVENT") {
    queueCounterIncrement(message.detail)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "FBPG_RESET_COUNTERS") {
    queueCounterReset()
      .then((counters) => sendResponse({ ok: true, counters }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function getSettings() {
  const { [SETTINGS_KEY]: settings } = await chrome.storage.sync.get(SETTINGS_KEY);
  return sanitizeSettings(settings);
}

async function saveSettings(nextSettings) {
  const settings = sanitizeSettings(nextSettings);

  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function migrateSettings() {
  const { [SETTINGS_KEY]: existing } = await chrome.storage.sync.get(SETTINGS_KEY);
  const nextSettings = sanitizeSettings(existing);

  await chrome.storage.sync.set({ [SETTINGS_KEY]: nextSettings });
}

function sanitizeSettings(value) {
  return {
    ...DEFAULT_SETTINGS,
    blockSeen: value && Object.prototype.hasOwnProperty.call(value, "blockSeen") ? Boolean(value.blockSeen) : DEFAULT_SETTINGS.blockSeen,
    blockStorySeen: value && Object.prototype.hasOwnProperty.call(value, "blockStorySeen") ? Boolean(value.blockStorySeen) : DEFAULT_SETTINGS.blockStorySeen,
    blockTyping: value && Object.prototype.hasOwnProperty.call(value, "blockTyping") ? Boolean(value.blockTyping) : DEFAULT_SETTINGS.blockTyping,
    debugMode: value && Object.prototype.hasOwnProperty.call(value, "debugMode") ? Boolean(value.debugMode) : DEFAULT_SETTINGS.debugMode,
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION
  };
}

async function getPausedTabs() {
  const { [PAUSED_TABS_KEY]: pausedTabs } = await chrome.storage.session.get(PAUSED_TABS_KEY);
  return pausedTabs || {};
}

async function getPopupState(tabId) {
  const [settings, pausedTabs, local] = await Promise.all([
    getSettings(),
    getPausedTabs(),
    chrome.storage.local.get(COUNTERS_KEY)
  ]);

  return {
    ok: true,
    settings,
    tabPaused: Boolean(tabId && pausedTabs[String(tabId)]),
    counters: local[COUNTERS_KEY] || {
      receipt: 0,
      typing: 0,
      total: 0,
      lastBlockedAt: null
    }
  };
}

async function incrementCounter(detail) {
  if (!counterHelpers) {
    throw new Error("Counter helper module is not available");
  }

  const { [COUNTERS_KEY]: existing } = await chrome.storage.local.get(COUNTERS_KEY);
  const counters = counterHelpers.addBlockedEvent(existing, detail);

  await chrome.storage.local.set({ [COUNTERS_KEY]: counters });
}

async function resetCounters() {
  if (!counterHelpers) {
    throw new Error("Counter helper module is not available");
  }

  const counters = counterHelpers.createEmptyCounterState();
  await chrome.storage.local.set({ [COUNTERS_KEY]: counters });
  return counters;
}

function queueCounterIncrement(detail) {
  counterWriteQueue = counterWriteQueue
    .catch(() => undefined)
    .then(() => incrementCounter(detail));

  return counterWriteQueue;
}

function queueCounterReset() {
  counterWriteQueue = counterWriteQueue
    .catch(() => undefined)
    .then(() => resetCounters());

  return counterWriteQueue;
}

async function setTabPaused(tabId, paused) {
  if (!tabId) {
    return;
  }

  const key = String(tabId);
  const pausedTabs = await getPausedTabs();

  if (paused) {
    pausedTabs[key] = Date.now();
  } else {
    delete pausedTabs[key];
  }

  await chrome.storage.session.set({ [PAUSED_TABS_KEY]: pausedTabs });
}
