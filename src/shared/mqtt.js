(function initMqttModule(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.FBPG_MQTT = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : undefined, function createMqttHelpers() {
  const DEFAULT_MAX_DECODE_BYTES = 16 * 1024;

  function inspectPublish(data, maxDecodeBytes = DEFAULT_MAX_DECODE_BYTES) {
    const bytes = toBytes(data);
    if (!bytes || !bytes.length) {
      return createResult({
        byteLength: bytes ? bytes.length : 0,
        text: typeof data === "string" ? data : ""
      });
    }

    const packetType = bytes[0] >> 4;
    const qos = packetType === 3 ? (bytes[0] >> 1) & 3 : null;
    const fallback = {
      packetType,
      qos,
      byteLength: bytes.length,
      text: decodeBytes(bytes, maxDecodeBytes)
    };

    if (packetType !== 3 || bytes.length < 4) {
      return createResult(fallback);
    }

    let offset = 1;
    let multiplier = 1;
    let remainingLength = 0;
    let encodedByte = 0;

    do {
      if (offset >= bytes.length || multiplier > 128 * 128 * 128) {
        return createResult(fallback);
      }
      encodedByte = bytes[offset++];
      remainingLength += (encodedByte & 127) * multiplier;
      multiplier *= 128;
    } while ((encodedByte & 128) !== 0);

    const variableHeaderStart = offset;
    if (offset + 2 > bytes.length) {
      return createResult(fallback);
    }

    const topicLength = (bytes[offset] << 8) + bytes[offset + 1];
    offset += 2;
    if (offset + topicLength > bytes.length) {
      return createResult(fallback);
    }

    const topic = decodeBytes(bytes.slice(offset, offset + topicLength), maxDecodeBytes);
    offset += topicLength;

    let packetIdentifier = null;
    if (qos > 0) {
      if (offset + 2 > bytes.length) {
        return createResult(fallback);
      }
      packetIdentifier = (bytes[offset] << 8) + bytes[offset + 1];
      offset += 2;
    }

    const variableHeaderLength = offset - variableHeaderStart;
    const payloadLength = Math.max(0, remainingLength - variableHeaderLength);
    const payloadEnd = Math.min(bytes.length, offset + payloadLength);
    const payloadText = decodeBytes(bytes.slice(offset, payloadEnd), maxDecodeBytes);

    return createResult({
      packetType,
      qos,
      packetIdentifier,
      byteLength: bytes.length,
      topic,
      text: `${topic}\n${payloadText}`
    });
  }

  function buildPuback(packetIdentifier) {
    const value = Number(packetIdentifier);
    if (!Number.isInteger(value) || value < 1 || value > 0xffff) {
      return null;
    }

    return Uint8Array.of(0x40, 0x02, value >> 8, value & 0xff);
  }

  function createResult(value) {
    return {
      packetType: null,
      qos: null,
      packetIdentifier: null,
      byteLength: 0,
      topic: "",
      text: "",
      ...value
    };
  }

  function toBytes(data) {
    if (typeof data === "string") {
      return new TextEncoder().encode(data);
    }

    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }

    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    return null;
  }

  function decodeBytes(bytes, maxDecodeBytes) {
    if (!bytes || !bytes.length) {
      return "";
    }

    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, maxDecodeBytes));
    } catch (_error) {
      return "";
    }
  }

  return {
    buildPuback,
    inspectPublish
  };
});
