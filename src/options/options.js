const SETTINGS_KEY = "fbpgSettings";
const COUNTERS_KEY = "fbpgCounters";
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
  debugMode: document.getElementById("debugMode")
};

const statsElements = {
  todayMessengerSeen: document.getElementById("todayMessengerSeenCount"),
  sinceMessengerSeen: document.getElementById("sinceMessengerSeenCount"),
  todayStorySeen: document.getElementById("todayStorySeenCount"),
  sinceStorySeen: document.getElementById("sinceStorySeenCount"),
  todayTyping: document.getElementById("todayTypingCount"),
  sinceTyping: document.getElementById("sinceTypingCount"),
  todayTotal: document.getElementById("todayTotalCount"),
  sinceTotal: document.getElementById("sinceTotalCount"),
  lastBlocked: document.getElementById("lastBlockedText")
};
const resetCounters = document.getElementById("resetCounters");
const saveStatus = document.getElementById("saveStatus");

let settings = { ...DEFAULT_SETTINGS };
let saveTimer = null;

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  const [{ [SETTINGS_KEY]: storedSettings }, { [COUNTERS_KEY]: counters }] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get(COUNTERS_KEY)
  ]);

  settings = {
    ...DEFAULT_SETTINGS,
    ...(storedSettings || {})
  };

  for (const [key, control] of Object.entries(controls)) {
    control.checked = settings[key];
    control.addEventListener("change", () => updateSetting(key, control.checked));
  }

  renderCounters(counters || {});
  resetCounters.addEventListener("click", resetDebugCounters);
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
  await applySettingsToFacebookTabs();
  if ((key === "blockSeen" || key === "blockStorySeen") && previousValue !== Boolean(value)) {
    await reloadFacebookTabs();
  }
  showSaved();
}

async function applySettingsToFacebookTabs() {
  const tabs = await chrome.tabs.query({
    url: [
      "*://*.facebook.com/*",
      "*://*.messenger.com/*"
    ]
  });

  await Promise.all(
    tabs.map((tab) =>
      chrome.tabs
        .sendMessage(tab.id, {
          type: "FBPG_APPLY_SETTINGS",
          settings
        })
        .catch(() => undefined)
    )
  );
}

async function reloadFacebookTabs() {
  const tabs = await chrome.tabs.query({
    url: [
      "*://*.facebook.com/*",
      "*://*.messenger.com/*"
    ]
  });

  await Promise.all(
    tabs.map((tab) => chrome.tabs.reload(tab.id).catch(() => undefined))
  );
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
    showSaved("Reset failed", true);
    return;
  }

  renderCounters(response.counters);
  showSaved("Counters reset");
}

function showSaved(message = "Saved", isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("is-error", isError);
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveStatus.textContent = "";
    saveStatus.classList.remove("is-error");
    saveTimer = null;
  }, 1400);
}
