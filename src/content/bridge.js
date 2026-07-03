(function initFacebookPrivacyGuardBridge() {
  if (window.__FBPG_BRIDGE__) {
    return;
  }
  window.__FBPG_BRIDGE__ = true;

  const SETTINGS_KEY = "fbpgSettings";
  const BRIDGE_SOURCE = "FBPG_BRIDGE";
  const MAIN_SOURCE = "FBPG_MAIN_GUARD";
  const DEFAULT_SETTINGS = {
    blockSeen: true,
    blockStorySeen: false,
    blockTyping: true,
    debugMode: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  let tabPaused = false;
  let mainPort = null;

  initialize().catch(ignoreInvalidatedContext);
  window.addEventListener("message", handleMainWorldPortRequest);

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes[SETTINGS_KEY]) {
        settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
        broadcastSettings();
      }
    });
  } catch (_error) {
    // The old content-script context can remain briefly after an extension reload.
  }

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") {
        return false;
      }

      if (message.type === "FBPG_SET_TAB_PAUSED") {
        tabPaused = Boolean(message.paused);
        broadcastSettings();
        sendResponse({ ok: true, paused: tabPaused });
        return true;
      }

      if (message.type === "FBPG_APPLY_SETTINGS") {
        settings = normalizeSettings(message.settings);
        broadcastSettings();
        sendResponse({ ok: true, settings });
        return true;
      }

      if (message.type === "FBPG_GET_CONTENT_STATE") {
        sendResponse({ ok: true, settings, tabPaused });
        return true;
      }

      return false;
    });
  } catch (_error) {
    // The old content-script context can remain briefly after an extension reload.
  }

  function handleMainWorldPortRequest(event) {
    const message = event.data || {};
    if (
      event.source !== window ||
      message.source !== MAIN_SOURCE ||
      message.type !== "PORT_REQUEST" ||
      typeof message.nonce !== "string" ||
      mainPort
    ) {
      return;
    }

    const channel = new MessageChannel();
    mainPort = channel.port1;
    mainPort.onmessage = handleMainWorldMessage;
    mainPort.start();

    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: "PORT_READY",
        nonce: message.nonce
      },
      "*",
      [channel.port2]
    );
    window.removeEventListener("message", handleMainWorldPortRequest);
    broadcastSettings();
  }

  function handleMainWorldMessage(event) {
    const message = event.data || {};
    if (message.source !== MAIN_SOURCE || typeof message.type !== "string") {
      return;
    }

    if (message.type === "MAIN_READY") {
      broadcastSettings();
      return;
    }

    if (message.type === "BLOCKED_EVENT") {
      recordBlockedEvent(message.detail || {});
    }
  }

  async function initialize() {
    const [{ [SETTINGS_KEY]: storedSettings }, pauseResponse] = await Promise.all([
      chrome.storage.sync.get(SETTINGS_KEY),
      chrome.runtime.sendMessage({ type: "FBPG_GET_TAB_PAUSE" }).catch(() => ({ paused: false }))
    ]);

    settings = normalizeSettings(storedSettings);
    tabPaused = Boolean(pauseResponse && pauseResponse.paused);
    broadcastSettings();
  }

  function normalizeSettings(value) {
    return {
      ...DEFAULT_SETTINGS,
      ...(value || {})
    };
  }

  function broadcastSettings() {
    postToMainWorld({
      type: "SETTINGS_UPDATE",
      settings,
      paused: tabPaused
    });
  }

  function postToMainWorld(message) {
    if (!mainPort) {
      return;
    }

    try {
      mainPort.postMessage({
        source: BRIDGE_SOURCE,
        ...message
      });
    } catch (_error) {
      mainPort = null;
    }
  }

  function recordBlockedEvent(detail) {
    if (detail.type !== "receipt" && detail.type !== "typing") {
      return;
    }

    chrome.runtime
      .sendMessage({
        type: "FBPG_RECORD_BLOCKED_EVENT",
        detail: {
          type: detail.type,
          reason: typeof detail.reason === "string" ? detail.reason : "",
          transport: typeof detail.transport === "string" ? detail.transport : "",
          at: Number.isFinite(Number(detail.at)) ? Number(detail.at) : Date.now()
        }
      })
      .catch(ignoreInvalidatedContext);
  }

  function ignoreInvalidatedContext(error) {
    if (!error || !/Extension context invalidated/i.test(String(error.message || error))) {
      return;
    }
  }
})();
