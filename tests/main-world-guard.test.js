const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const matchers = require("../src/shared/matchers.js");
const mqtt = require("../src/shared/mqtt.js");

const guardSource = fs.readFileSync(
  path.join(__dirname, "../src/content/main-world-guard.js"),
  "utf8"
);

test("locally acknowledges blocked QoS 1 receipts without sending them", async () => {
  const { socket } = createGuardedSocket();
  const received = [];
  socket.addEventListener("message", (event) => received.push(event.data));

  socket.send(
    createPublish({
      qos: 1,
      packetIdentifier: 0x1234,
      topic: "/messaging_events",
      payload: "{\"type\":\"read_receipt\"}"
    })
  );

  await waitForTimers();

  assert.equal(socket.nativeSends.length, 0);
  assert.equal(received.length, 1);
  assert.deepEqual(Array.from(new Uint8Array(received[0])), [0x40, 0x02, 0x12, 0x34]);
});

test("continues sending normal message publishes", () => {
  const { socket } = createGuardedSocket();

  socket.send(
    createPublish({
      qos: 1,
      packetIdentifier: 7,
      topic: "/messaging_events",
      payload: "composer_send_message secure_composer send_typing_indicators message_type"
    })
  );

  assert.equal(socket.nativeSends.length, 1);
});

test("preserves QoS 2 receipts because they require a multi-stage handshake", () => {
  const { socket } = createGuardedSocket();

  socket.send(
    createPublish({
      qos: 2,
      packetIdentifier: 9,
      topic: "/messaging_events",
      payload: "{\"type\":\"read_receipt\"}"
    })
  );

  assert.equal(socket.nativeSends.length, 1);
});

function createGuardedSocket() {
  class MockWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      super();
      this.url = url;
      this.binaryType = "arraybuffer";
      this.readyState = MockWebSocket.OPEN;
      this.nativeSends = [];
    }

    send(data) {
      this.nativeSends.push(data);
    }
  }

  const window = {
    FBPG_MATCHERS: matchers,
    FBPG_MQTT: mqtt,
    WebSocket: MockWebSocket,
    XMLHttpRequest: null,
    Worker: null,
    MessagePort: null,
    fetch: null,
    addEventListener() {},
    removeEventListener() {},
    postMessage() {},
    setTimeout(callback, delay) {
      return delay === 0 ? setTimeout(callback, 0) : 0;
    }
  };
  window.window = window;

  const context = vm.createContext({
    ArrayBuffer,
    Blob,
    Date,
    Event,
    EventTarget,
    Math,
    MessageEvent,
    TextDecoder,
    TextEncoder,
    URL,
    Uint8Array,
    console: { log() {} },
    crypto: webcrypto,
    location: { href: "https://www.facebook.com/" },
    navigator: {},
    queueMicrotask,
    setTimeout,
    window
  });

  vm.runInContext(guardSource, context);
  return {
    socket: new window.WebSocket("wss://edge-chat.facebook.com/chat")
  };
}

function createPublish({ qos, packetIdentifier, topic, payload }) {
  const topicBytes = new TextEncoder().encode(topic);
  const payloadBytes = new TextEncoder().encode(payload);
  const remainingLength = 2 + topicBytes.length + 2 + payloadBytes.length;
  const packet = new Uint8Array(2 + remainingLength);
  let offset = 0;

  packet[offset++] = 0x30 | (qos << 1);
  packet[offset++] = remainingLength;
  packet[offset++] = topicBytes.length >> 8;
  packet[offset++] = topicBytes.length & 0xff;
  packet.set(topicBytes, offset);
  offset += topicBytes.length;
  packet[offset++] = packetIdentifier >> 8;
  packet[offset++] = packetIdentifier & 0xff;
  packet.set(payloadBytes, offset);

  return packet;
}

function waitForTimers() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
