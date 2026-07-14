const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPuback, inspectPublish } = require("../src/shared/mqtt.js");

test("parses QoS 1 MQTT publishes without treating the packet id as payload", () => {
  const packet = createPublish({
    qos: 1,
    packetIdentifier: 0x1234,
    topic: "/messaging_events",
    payload: "{\"type\":\"read_receipt\"}"
  });

  const result = inspectPublish(packet);

  assert.equal(result.packetType, 3);
  assert.equal(result.qos, 1);
  assert.equal(result.packetIdentifier, 0x1234);
  assert.equal(result.topic, "/messaging_events");
  assert.match(result.text, /read_receipt/);
});

test("parses QoS 0 MQTT publishes without a packet id", () => {
  const packet = createPublish({
    qos: 0,
    topic: "/thread_typing",
    payload: "send_typing_indicators"
  });

  const result = inspectPublish(packet);

  assert.equal(result.qos, 0);
  assert.equal(result.packetIdentifier, null);
  assert.equal(result.topic, "/thread_typing");
  assert.match(result.text, /send_typing_indicators/);
});

test("builds MQTT PUBACK packets for valid identifiers", () => {
  assert.deepEqual(Array.from(buildPuback(0x1234)), [0x40, 0x02, 0x12, 0x34]);
  assert.equal(buildPuback(0), null);
  assert.equal(buildPuback(0x10000), null);
});

function createPublish({ qos, packetIdentifier = null, topic, payload }) {
  const topicBytes = new TextEncoder().encode(topic);
  const payloadBytes = new TextEncoder().encode(payload);
  const variableHeaderLength = 2 + topicBytes.length + (qos > 0 ? 2 : 0);
  const remainingLength = variableHeaderLength + payloadBytes.length;
  const remainingLengthBytes = encodeRemainingLength(remainingLength);
  const packet = new Uint8Array(1 + remainingLengthBytes.length + remainingLength);
  let offset = 0;

  packet[offset++] = 0x30 | (qos << 1);
  packet.set(remainingLengthBytes, offset);
  offset += remainingLengthBytes.length;
  packet[offset++] = topicBytes.length >> 8;
  packet[offset++] = topicBytes.length & 0xff;
  packet.set(topicBytes, offset);
  offset += topicBytes.length;

  if (qos > 0) {
    packet[offset++] = packetIdentifier >> 8;
    packet[offset++] = packetIdentifier & 0xff;
  }

  packet.set(payloadBytes, offset);
  return packet;
}

function encodeRemainingLength(value) {
  const bytes = [];
  let remaining = value;

  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining > 0);

  return Uint8Array.from(bytes);
}
