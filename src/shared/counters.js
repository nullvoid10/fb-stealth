(function initCounterModule(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.FBPG_COUNTERS = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : undefined, function createCounterHelpers() {
  const COUNTER_SCHEMA_VERSION = 2;
  const CATEGORIES = ["messengerSeen", "storySeen", "typing"];

  function createEmptyCounterState(now = Date.now()) {
    return {
      schemaVersion: COUNTER_SCHEMA_VERSION,
      resetAt: now,
      todayKey: dayKey(now),
      today: zeroCounts(),
      sinceReset: zeroCounts(),
      lastBlockedAt: null
    };
  }

  function zeroCounts() {
    return {
      messengerSeen: 0,
      storySeen: 0,
      typing: 0,
      total: 0
    };
  }

  function normalizeCounterState(value, now = Date.now()) {
    const currentDayKey = dayKey(now);

    if (value && value.schemaVersion === COUNTER_SCHEMA_VERSION) {
      const state = {
        schemaVersion: COUNTER_SCHEMA_VERSION,
        resetAt: toTimestamp(value.resetAt, now),
        todayKey: typeof value.todayKey === "string" ? value.todayKey : currentDayKey,
        today: normalizeCounts(value.today),
        sinceReset: normalizeCounts(value.sinceReset),
        lastBlockedAt: toNullableTimestamp(value.lastBlockedAt)
      };

      if (state.todayKey !== currentDayKey) {
        state.todayKey = currentDayKey;
        state.today = zeroCounts();
      }

      return state;
    }

    return migrateLegacyCounterState(value, now);
  }

  function migrateLegacyCounterState(value, now = Date.now()) {
    const state = createEmptyCounterState(now);
    if (!value || typeof value !== "object") {
      return state;
    }

    const messengerSeen = toCount(value.receipt);
    const typing = toCount(value.typing);
    const total = toCount(value.total) || messengerSeen + typing;

    state.sinceReset.messengerSeen = messengerSeen;
    state.sinceReset.typing = typing;
    state.sinceReset.total = total;
    state.lastBlockedAt = toNullableTimestamp(value.lastBlockedAt);

    if (state.lastBlockedAt && dayKey(state.lastBlockedAt) === state.todayKey) {
      state.today.messengerSeen = messengerSeen;
      state.today.typing = typing;
      state.today.total = total;
    }

    return state;
  }

  function addBlockedEvent(existing, detail, now = Date.now()) {
    const category = classifyBlockedEvent(detail);
    const state = normalizeCounterState(existing, now);

    if (!category) {
      return state;
    }

    if (state.todayKey !== dayKey(now)) {
      state.todayKey = dayKey(now);
      state.today = zeroCounts();
    }

    incrementCounts(state.today, category);
    incrementCounts(state.sinceReset, category);
    state.lastBlockedAt = now;
    return state;
  }

  function classifyBlockedEvent(detail) {
    if (!detail || typeof detail !== "object") {
      return null;
    }

    if (detail.type === "typing") {
      return "typing";
    }

    if (detail.type !== "receipt") {
      return null;
    }

    return detail.reason === "story-seen-receipt" ? "storySeen" : "messengerSeen";
  }

  function incrementCounts(counts, category) {
    if (!CATEGORIES.includes(category)) {
      return;
    }

    counts[category] += 1;
    counts.total += 1;
  }

  function normalizeCounts(value) {
    const counts = zeroCounts();

    if (!value || typeof value !== "object") {
      return counts;
    }

    counts.messengerSeen = toCount(value.messengerSeen);
    counts.storySeen = toCount(value.storySeen);
    counts.typing = toCount(value.typing);
    counts.total = toCount(value.total) || counts.messengerSeen + counts.storySeen + counts.typing;
    return counts;
  }

  function formatRelativeTime(timestamp, now = Date.now()) {
    const value = toNullableTimestamp(timestamp);
    if (!value) {
      return "Never";
    }

    const seconds = Math.max(0, Math.floor((now - value) / 1000));
    if (seconds < 10) {
      return "Just now";
    }
    if (seconds < 60) {
      return `${seconds}s ago`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function dayKey(timestamp) {
    const date = new Date(toTimestamp(timestamp, Date.now()));
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function toCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function toTimestamp(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function toNullableTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  return {
    addBlockedEvent,
    classifyBlockedEvent,
    createEmptyCounterState,
    formatRelativeTime,
    normalizeCounterState,
    zeroCounts
  };
});
