(function initFacebookPrivacyGuard() {
  if (window.__FBPG_MAIN_WORLD_GUARD__) {
    return;
  }
  window.__FBPG_MAIN_WORLD_GUARD__ = true;

  const DIAGNOSTICS_ENABLED = true;
  const DIAGNOSTIC_LOG_LIMIT = 1000;
  const BUILD_VERSION = "0.2.10";
  const BRIDGE_SOURCE = "FBPG_BRIDGE";
  const MAIN_SOURCE = "FBPG_MAIN_GUARD";
  const MAX_DECODE_BYTES = 16 * 1024;
  const matchers = window.FBPG_MATCHERS;
  const mqttHelpers = window.FBPG_MQTT;
  const handshakeNonce = randomId();
  const postWindowMessage = window.postMessage.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const debugLog = console.log.bind(console);
  let diagnosticLogCount = 0;
  let bridgePort = null;
  let settingsReady = false;
  const queuedBlockedEvents = [];
  const state = {
    settings: {
      blockSeen: true,
      blockStorySeen: false,
      blockTyping: true,
      debugMode: false
    },
    paused: false
  };

  setupBridgePort();
  patchFetch();
  patchXMLHttpRequest();
  patchSendBeacon();
  patchWebSocket();
  patchWorkerTypingMessaging();

  function shouldBlockRequest(details) {
    if (state.paused || !matchers) {
      return {
        blocked: false,
        type: "none",
        reason: "paused-or-unavailable"
      };
    }

    const effectiveSettings = settingsReady
      ? state.settings
      : {
          ...state.settings,
          blockStorySeen: true
        };

    return matchers.shouldBlock(details, effectiveSettings);
  }

  function reportBlocked(result, transport) {
    postBlockedEvent({
      type: result.type,
      reason: result.reason,
      transport,
      at: Date.now()
    });
  }

  function publicSettingsSnapshot() {
    return {
      blockSeen: Boolean(state.settings.blockSeen),
      blockStorySeen: Boolean(state.settings.blockStorySeen),
      blockTyping: Boolean(state.settings.blockTyping),
      debugMode: Boolean(state.settings.debugMode)
    };
  }

  function randomId() {
    const bytes = new Uint8Array(16);
    try {
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch (_error) {
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  function setupBridgePort() {
    window.addEventListener("message", handleBridgePortReady);
    requestBridgePort(0);
  }

  function requestBridgePort(attempt) {
    if (bridgePort) {
      return;
    }

    postWindowMessage(
      {
        source: MAIN_SOURCE,
        type: "PORT_REQUEST",
        nonce: handshakeNonce
      },
      "*"
    );

    if (attempt < 5) {
      nativeSetTimeout(() => requestBridgePort(attempt + 1), 25 * (attempt + 1));
    }
  }

  function handleBridgePortReady(event) {
    const message = event.data || {};
    if (
      event.source !== window ||
      message.source !== BRIDGE_SOURCE ||
      message.type !== "PORT_READY" ||
      message.nonce !== handshakeNonce ||
      !event.ports ||
      !event.ports[0] ||
      bridgePort
    ) {
      return;
    }

    bridgePort = event.ports[0];
    bridgePort.onmessage = handleBridgeMessage;
    bridgePort.start();
    window.removeEventListener("message", handleBridgePortReady);
    postBridgeMessage({ type: "MAIN_READY" });
    flushBlockedEvents();
    diagnosticLog("ready", {
      version: BUILD_VERSION,
      hasMatchers: Boolean(matchers),
      webSocketWrapped: Boolean(window.WebSocket && window.WebSocket.__fbpgPatched),
      workerMessagingWrapped: hasWorkerTypingMessagingPatch(),
      settings: publicSettingsSnapshot()
    });
  }

  function handleBridgeMessage(event) {
    const message = event.data || {};
    if (message.source !== BRIDGE_SOURCE || typeof message.type !== "string") {
      return;
    }

    if (message.type === "SETTINGS_UPDATE") {
      state.settings = {
        ...state.settings,
        ...(message.settings || {})
      };
      settingsReady = true;
      state.paused = Boolean(message.paused);
      diagnosticLog("settings", {
        settings: publicSettingsSnapshot(),
        paused: state.paused
      });
    }
  }

  function postBridgeMessage(message) {
    if (!bridgePort) {
      return false;
    }

    try {
      bridgePort.postMessage({
        source: MAIN_SOURCE,
        ...message
      });
      return true;
    } catch (_error) {
      bridgePort = null;
      return false;
    }
  }

  function postBlockedEvent(detail) {
    if (
      !postBridgeMessage({
        type: "BLOCKED_EVENT",
        detail
      }) &&
      queuedBlockedEvents.length < 50
    ) {
      queuedBlockedEvents.push(detail);
    }
  }

  function flushBlockedEvents() {
    while (queuedBlockedEvents.length && bridgePort) {
      const detail = queuedBlockedEvents.shift();
      postBlockedEvent(detail);
    }
  }

  function emptyFetchResponse() {
    return Promise.resolve(
      new Response("{}", {
        status: 200,
        statusText: "Blocked by FB Stealth"
      })
    );
  }

  function patchFetch() {
    if (!window.fetch || window.fetch.__fbpgPatched) {
      return;
    }

    const originalFetch = window.fetch;
    function guardedFetch(input, init) {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input && input.url;
      const body = init && Object.prototype.hasOwnProperty.call(init, "body") ? init.body : undefined;
      const method = (init && init.method) || (input && input.method) || "GET";
      const details = { url, method, body };
      const result = shouldBlockRequest(details);
      diagnosticRequest("fetch", details, result);

      if (result.blocked) {
        reportBlocked(result, "fetch");
        return emptyFetchResponse();
      }

      return originalFetch.apply(this, arguments);
    }

    guardedFetch.__fbpgPatched = true;
    window.fetch = guardedFetch;
  }

  function patchXMLHttpRequest() {
    if (!window.XMLHttpRequest || window.XMLHttpRequest.prototype.__fbpgPatched) {
      return;
    }

    const proto = window.XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;

    proto.open = function guardedOpen(method, url) {
      this.__fbpgRequest = { method, url };
      return originalOpen.apply(this, arguments);
    };

    proto.send = function guardedSend(body) {
      const request = this.__fbpgRequest || {};
      const details = {
        url: request.url,
        method: request.method,
        body
      };
      const result = shouldBlockRequest(details);
      diagnosticRequest("xhr", details, result);

      if (result.blocked) {
        reportBlocked(result, "xhr");
        finishBlockedXhr(this);
        return undefined;
      }

      return originalSend.apply(this, arguments);
    };

    proto.__fbpgPatched = true;
  }

  function finishBlockedXhr(xhr) {
    queueMicrotask(() => {
      defineXhrValue(xhr, "readyState", 4);
      defineXhrValue(xhr, "status", 200);
      defineXhrValue(xhr, "statusText", "OK");
      defineXhrValue(xhr, "responseURL", "");
      defineXhrValue(xhr, "responseText", "{}");

      if (!xhr.responseType || xhr.responseType === "text") {
        defineXhrValue(xhr, "response", "{}");
      } else if (xhr.responseType === "json") {
        defineXhrValue(xhr, "response", {});
      }

      dispatchXhrEvent(xhr, "readystatechange");
      dispatchXhrEvent(xhr, "load");
      dispatchXhrEvent(xhr, "loadend");
    });
  }

  function defineXhrValue(xhr, key, value) {
    try {
      Object.defineProperty(xhr, key, {
        configurable: true,
        value
      });
    } catch (_error) {
      // Some XHR properties are implementation-defined and cannot be replaced.
    }
  }

  function dispatchXhrEvent(xhr, type) {
    try {
      xhr.dispatchEvent(new Event(type));
    } catch (_error) {
      // Ignore dispatch errors on unusual XHR implementations.
    }

    const handler = xhr[`on${type}`];
    if (typeof handler === "function") {
      try {
        handler.call(xhr, new Event(type));
      } catch (_error) {
        // Match browser event dispatch behavior: do not break the caller.
      }
    }
  }

  function patchSendBeacon() {
    if (!navigator.sendBeacon || navigator.sendBeacon.__fbpgPatched) {
      return;
    }

    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    function guardedSendBeacon(url, data) {
      const details = { url, method: "POST", body: data };
      const result = shouldBlockRequest(details);
      diagnosticRequest("beacon", details, result);

      if (result.blocked) {
        reportBlocked(result, "beacon");
        return true;
      }

      return originalSendBeacon(url, data);
    }

    guardedSendBeacon.__fbpgPatched = true;
    navigator.sendBeacon = guardedSendBeacon;
  }

  function patchWebSocket() {
    if (!window.WebSocket || window.WebSocket.__fbpgPatched) {
      return;
    }

    const NativeWebSocket = window.WebSocket;
    const proto = NativeWebSocket.prototype;
    const originalSend = proto.send;

    function guardedSend(socket, args) {
      const data = args[0];
      const mqtt = mqttHelpers
        ? mqttHelpers.inspectPublish(data, MAX_DECODE_BYTES)
        : {
            packetType: null,
            qos: null,
            packetIdentifier: null,
            byteLength: 0,
            topic: "",
            text: ""
          };
      const details = {
        url: socket.url || "websocket",
        method: "WS",
        topic: mqtt.topic,
        body: mqtt.text || data,
        packetType: mqtt.packetType,
        qos: mqtt.qos,
        byteLength: mqtt.byteLength
      };
      const result = shouldBlockRequest(details);
      const puback =
        result.blocked && mqtt.packetType === 3 && mqtt.qos === 1 && mqttHelpers
          ? mqttHelpers.buildPuback(mqtt.packetIdentifier)
          : null;
      const effectiveResult =
        result.blocked && mqtt.packetType === 3 && mqtt.qos > 0 && !puback
          ? {
              ...result,
              blocked: false,
              reason: "mqtt-ack-unavailable-preserved"
            }
          : {
              ...result,
              localMqttAck: Boolean(puback)
            };
      diagnosticRequest("websocket", details, effectiveResult);

      if (effectiveResult.blocked) {
        if (puback) {
          dispatchMqttPuback(socket, puback, args);
        }
        reportBlocked(effectiveResult, "websocket");
        return undefined;
      }

      return originalSend.apply(socket, args);
    }

    // Dropping a QoS 1 publish without an ACK eventually blocks later Messenger sends.
    function dispatchMqttPuback(socket, puback, originalArgs) {
      nativeSetTimeout(() => {
        try {
          const data =
            socket.binaryType === "blob" && typeof Blob !== "undefined"
              ? new Blob([puback], { type: "application/octet-stream" })
              : puback.buffer.slice(puback.byteOffset, puback.byteOffset + puback.byteLength);
          socket.dispatchEvent(new MessageEvent("message", { data }));
        } catch (_error) {
          try {
            originalSend.apply(socket, originalArgs);
          } catch (_sendError) {
            // Messenger will reconnect a closed socket through its native error path.
          }
        }
      }, 0);
    }

    function guardedWebSocketSend(data) {
      return guardedSend(this, arguments);
    }

    function GuardedWebSocket(url, protocols) {
      const socket =
        arguments.length > 1
          ? new NativeWebSocket(url, protocols)
          : new NativeWebSocket(url);

      try {
        Object.defineProperty(socket, "send", {
          configurable: true,
          writable: true,
          value: function guardedInstanceWebSocketSend(data) {
            return guardedSend(socket, arguments);
          }
        });
      } catch (_error) {
        // Some browser implementations may not allow own-property replacement.
      }

      return socket;
    }

    proto.send = guardedWebSocketSend;
    proto.__fbpgPatched = true;
    GuardedWebSocket.prototype = proto;
    GuardedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    GuardedWebSocket.OPEN = NativeWebSocket.OPEN;
    GuardedWebSocket.CLOSING = NativeWebSocket.CLOSING;
    GuardedWebSocket.CLOSED = NativeWebSocket.CLOSED;
    GuardedWebSocket.__fbpgPatched = true;
    window.WebSocket = GuardedWebSocket;
  }

  function patchWorkerTypingMessaging() {
    patchTypingPostMessagePrototype(
      window.Worker && window.Worker.prototype,
      "Worker.postMessage",
      "worker"
    );
    patchTypingPostMessagePrototype(
      window.MessagePort && window.MessagePort.prototype,
      "MessagePort.postMessage",
      "message-port"
    );
  }

  function hasWorkerTypingMessagingPatch() {
    return Boolean(
      (window.Worker && window.Worker.prototype && window.Worker.prototype.__fbpgTypingPostMessagePatched) ||
        (window.MessagePort && window.MessagePort.prototype && window.MessagePort.prototype.__fbpgTypingPostMessagePatched)
    );
  }

  function patchTypingPostMessagePrototype(proto, label, transport) {
    if (!proto || !proto.postMessage || proto.__fbpgTypingPostMessagePatched) {
      return;
    }

    const originalPostMessage = proto.postMessage;
    proto.postMessage = function guardedTypingPostMessage(message, transfer) {
      const details = {
        url: `fbpg://${label}`,
        method: "POSTMESSAGE",
        body: message
      };
      const result = shouldBlockRequest(details);
      const effectiveResult =
        result.type === "typing" || result.reason === "story-seen-receipt"
          ? result
          : {
              ...result,
              blocked: false,
              reason: result.type === "receipt" ? "worker-receipt-preserved" : result.reason
            };
      diagnosticRequest(transport, details, effectiveResult);

      if (effectiveResult.blocked) {
        reportBlocked(effectiveResult, transport);
        return undefined;
      }

      return originalPostMessage.apply(this, arguments);
    };

    proto.__fbpgTypingPostMessagePatched = true;
  }

  function diagnosticRequest(transport, details, result) {
    if (!DIAGNOSTICS_ENABLED || !state.settings.debugMode) {
      return;
    }

    const summary = summarizeDetails(details);
    const interesting =
      result.blocked ||
      result.type !== "none" ||
      summary.urlPath.includes("/ajax/") ||
      summary.urlPath.includes("/graphql") ||
      summary.urlPath.includes("/api/");

    if (!interesting) {
      return;
    }

    diagnosticLog("request", {
      transport,
      method: details.method || "",
      urlPath: summary.urlPath,
      packetType: details.packetType == null ? "" : details.packetType,
      qos: details.qos == null ? "" : details.qos,
      byteLength: details.byteLength || "",
      localMqttAck: Boolean(result.localMqttAck),
      blocked: result.blocked,
      type: result.type,
      reason: result.reason,
      paused: state.paused,
      settings: {
        blockSeen: Boolean(state.settings.blockSeen),
        blockStorySeen: Boolean(state.settings.blockStorySeen),
        blockTyping: Boolean(state.settings.blockTyping),
        debugMode: Boolean(state.settings.debugMode)
      }
    });
  }

  function diagnosticLog(label, payload) {
    if (!DIAGNOSTICS_ENABLED || !state.settings.debugMode || diagnosticLogCount >= DIAGNOSTIC_LOG_LIMIT) {
      return;
    }

    diagnosticLogCount += 1;
    debugLog(`[FBPG:${label}]`, {
      index: diagnosticLogCount,
      at: new Date().toISOString(),
      label,
      payload
    });
  }

  function summarizeDetails(details) {
    const url = String(details.url || "");
    return {
      urlPath: safeUrlPath(url)
    };
  }

  function safeUrlPath(url) {
    try {
      const parsed = new URL(url, location.href);
      const safePath = parsed.pathname
        .split("/")
        .map(redactPathSegment)
        .join("/");
      return `${parsed.hostname}${safePath}`;
    } catch (_error) {
      return String(url)
        .split("?")[0]
        .split("/")
        .map(redactPathSegment)
        .join("/")
        .slice(0, 180);
    }
  }

  function redactPathSegment(segment) {
    if (!segment) {
      return "";
    }

    const value = segment.slice(0, 120);
    if (/^\d+$/.test(value) || /^[A-Za-z0-9_-]{16,}$/.test(value)) {
      return ":id";
    }

    return value;
  }
})();
