const assert = require("node:assert/strict");
const test = require("node:test");
const {
  addBlockedEvent,
  classifyBlockedEvent,
  createEmptyCounterState,
  formatRelativeTime,
  normalizeCounterState
} = require("../src/shared/counters");

const NOW = new Date("2026-07-04T12:00:00").getTime();
const YESTERDAY = new Date("2026-07-03T12:00:00").getTime();

test("classifies blocked events into privacy summary categories", () => {
  assert.equal(classifyBlockedEvent({ type: "receipt", reason: "read-receipt" }), "messengerSeen");
  assert.equal(classifyBlockedEvent({ type: "receipt", reason: "story-seen-receipt" }), "storySeen");
  assert.equal(classifyBlockedEvent({ type: "typing", reason: "typing-indicator" }), "typing");
  assert.equal(classifyBlockedEvent({ type: "none", reason: "no-match" }), null);
});

test("increments today and since reset counters by category", () => {
  let state = createEmptyCounterState(NOW);
  state = addBlockedEvent(state, { type: "receipt", reason: "read-receipt" }, NOW);
  state = addBlockedEvent(state, { type: "receipt", reason: "story-seen-receipt" }, NOW + 1000);
  state = addBlockedEvent(state, { type: "typing", reason: "typing-indicator" }, NOW + 2000);

  assert.deepEqual(state.today, {
    messengerSeen: 1,
    storySeen: 1,
    typing: 1,
    total: 3
  });
  assert.deepEqual(state.sinceReset, state.today);
  assert.equal(state.lastBlockedAt, NOW + 2000);
});

test("migrates legacy receipt and typing counters without storing details", () => {
  const state = normalizeCounterState(
    {
      receipt: 4,
      typing: 2,
      total: 6,
      lastBlockedAt: NOW
    },
    NOW
  );

  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.sinceReset, {
    messengerSeen: 4,
    storySeen: 0,
    typing: 2,
    total: 6
  });
  assert.deepEqual(state.today, state.sinceReset);
});

test("clears today counters when migrated legacy activity is from another day", () => {
  const state = normalizeCounterState(
    {
      receipt: 4,
      typing: 2,
      total: 6,
      lastBlockedAt: YESTERDAY
    },
    NOW
  );

  assert.deepEqual(state.today, {
    messengerSeen: 0,
    storySeen: 0,
    typing: 0,
    total: 0
  });
  assert.equal(state.sinceReset.total, 6);
});

test("rolls today counters forward without clearing since reset", () => {
  const state = addBlockedEvent(
    {
      schemaVersion: 2,
      resetAt: YESTERDAY,
      todayKey: "2026-07-03",
      today: {
        messengerSeen: 5,
        storySeen: 1,
        typing: 2,
        total: 8
      },
      sinceReset: {
        messengerSeen: 5,
        storySeen: 1,
        typing: 2,
        total: 8
      },
      lastBlockedAt: YESTERDAY
    },
    { type: "typing", reason: "typing-indicator" },
    NOW
  );

  assert.deepEqual(state.today, {
    messengerSeen: 0,
    storySeen: 0,
    typing: 1,
    total: 1
  });
  assert.deepEqual(state.sinceReset, {
    messengerSeen: 5,
    storySeen: 1,
    typing: 3,
    total: 9
  });
});

test("formats last blocked timestamps for popup display", () => {
  assert.equal(formatRelativeTime(null, NOW), "Never");
  assert.equal(formatRelativeTime(NOW - 5000, NOW), "Just now");
  assert.equal(formatRelativeTime(NOW - 45_000, NOW), "45s ago");
  assert.equal(formatRelativeTime(NOW - 120_000, NOW), "2m ago");
  assert.equal(formatRelativeTime(NOW - 7_200_000, NOW), "2h ago");
});
