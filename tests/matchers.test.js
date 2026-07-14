const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyRequest, shouldBlock } = require("../src/shared/matchers");

test("blocks legacy read receipt endpoint", () => {
  const result = classifyRequest({
    url: "https://www.facebook.com/ajax/mercury/change_read_status.php",
    method: "POST",
    body: "ids%5B123%5D=true"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "receipt");
});

test("blocks GraphQL read receipt operation names", () => {
  const result = classifyRequest({
    url: "https://www.facebook.com/api/graphql/",
    method: "POST",
    body: "fb_api_req_friendly_name=CometMessengerMarkThreadReadMutation&variables=%7B%7D"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "receipt");
});

test("blocks newer Messenger thread mark-read operation names", () => {
  const result = classifyRequest({
    url: "https://www.facebook.com/api/graphql/",
    method: "POST",
    body: "fb_api_req_friendly_name=MWThreadMarkReadMutation&variables=%7B%7D"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "receipt");
});

test("blocks typing endpoint", () => {
  const result = classifyRequest({
    url: "https://www.facebook.com/ajax/mercury/send_typing.php",
    method: "POST",
    body: "thread=123"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "typing");
});

test("blocks GraphQL typing operation names", () => {
  const result = classifyRequest({
    url: "https://www.messenger.com/api/graphql/",
    method: "POST",
    body: "fb_api_req_friendly_name=MWChatTypingIndicatorMutation&variables=%7B%7D"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "typing");
});

test("blocks realtime send typing indicator payloads", () => {
  const result = classifyRequest({
    url: "wss://gateway.facebook.com/ws/realtime",
    method: "WS",
    body: "send_typing_indicators thread_fbid thread_type"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "typing");
});

test("blocks realtime composing and user activity typing payloads", () => {
  for (const body of [
    "typing_state is_composing thread_fbid",
    "keyboard_activity compose_status thread_fbid",
    "FBGQLS:USER_ACTIVITY_UPDATE typing_indicator",
    "backend_sendChatStateFromComposer_start receive.handled.backend.sendChatStateFromComposer.ui.123"
  ]) {
    const result = classifyRequest({
      url: "wss://gateway.facebook.com/ws/realtime",
      method: "WS",
      body
    });

    assert.equal(result.blocked, true);
    assert.equal(result.type, "typing");
  }
});

test("blocks newer Messenger typing indicator operation names", () => {
  const result = classifyRequest({
    url: "https://www.messenger.com/api/graphql/",
    method: "POST",
    body: "fb_api_req_friendly_name=CometTypingIndicatorMutation&variables=%7B%7D"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "typing");
});

test("blocks MQTT typing topics", () => {
  const result = classifyRequest({
    url: "wss://edge-chat.messenger.com/chat",
    method: "WS",
    topic: "/thread_typing",
    body: "{}"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "typing");
});

test("blocks MQTT read receipt payloads", () => {
  const result = classifyRequest({
    url: "wss://edge-chat.messenger.com/chat",
    method: "WS",
    topic: "/messaging_events",
    body: "{\"type\":\"read_receipt\"}"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "receipt");
});

test("classifies acknowledged MQTT privacy frames for transport-level handling", () => {
  for (const [body, expectedType] of [
    ["{\"type\":\"read_receipt\"}", "receipt"],
    ["send_typing_indicators thread_fbid", "typing"]
  ]) {
    const result = shouldBlock(
      {
        url: "wss://edge-chat.messenger.com/chat",
        method: "WS",
        packetType: 3,
        qos: 1,
        body
      },
      {
        blockSeen: true,
        blockStorySeen: true,
        blockTyping: true
      }
    );

    assert.equal(result.blocked, true);
    assert.equal(result.type, expectedType);
  }
});

test("continues blocking unacknowledged MQTT read receipts", () => {
  const result = shouldBlock(
    {
      url: "wss://edge-chat.messenger.com/chat",
      method: "WS",
      packetType: 3,
      qos: 0,
      body: "{\"type\":\"read_receipt\"}"
    },
    {
      blockSeen: true,
      blockStorySeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "read-receipt");
});

test("preserves realtime read receipt payloads when bundled with thread flow tokens", () => {
  const result = shouldBlock(
    {
      url: "wss://gateway.facebook.com/ws/realtime",
      method: "WS",
      body: "message_thread_events mark_thread_as_read seen_receipt read_receipt consistent_thread_fbid thread_type"
    },
    {
      blockSeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.type, "receipt");
  assert.equal(result.reason, "preserved-message-send");
});

test("blocks lightspeed last read watermark payloads", () => {
  const result = classifyRequest({
    url: "wss://gateway.facebook.com/ws/lightspeed",
    method: "WS",
    body: "thread_id last_read_watermark_ts"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "receipt");
});

test("blocks Facebook story seen GraphQL payloads when story blocking is enabled", () => {
  for (const body of [
    "fb_api_req_friendly_name=CometStoriesMarkSeenMutation&variables=%7B%22story_id%22%3A%22123%22%7D",
    "fb_api_req_friendly_name=StoriesMarkStorySeenMutation&variables=%7B%7D",
    "fb_api_req_friendly_name=storiesUpdateSeenStateMutation&variables=%7B%22bucket_id%22%3A%22123%22%2C%22story_id%22%3A%22456%22%7D",
    "{\"operationName\":\"StoriesMarkStorySeenMutation\",\"variables\":{\"story_id\":\"123\"}}",
    "mark_story_seen story_id=123",
    "story_view_receipt story_card_id=123"
  ]) {
    const result = shouldBlock(
      {
        url: "https://www.facebook.com/api/graphql/",
        method: "POST",
        body
      },
      {
        blockSeen: true,
        blockStorySeen: true,
        blockTyping: true
      }
    );

    assert.equal(result.blocked, true);
    assert.equal(result.type, "receipt");
    assert.equal(result.reason, "story-seen-receipt");
  }
});

test("does not block story seen payloads when story blocking is disabled", () => {
  const result = shouldBlock(
    {
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      body: "fb_api_req_friendly_name=CometStoriesMarkSeenMutation&variables=%7B%7D"
    },
    {
      blockSeen: false,
      blockStorySeen: false,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.type, "receipt");
  assert.equal(result.reason, "story-seen-disabled");
});

test("blocks story seen independently from Messenger seen", () => {
  const result = shouldBlock(
    {
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      body: "fb_api_req_friendly_name=storiesUpdateSeenStateMutation&variables=%7B%7D"
    },
    {
      blockSeen: false,
      blockStorySeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "story-seen-receipt");
});

test("blocks exact story seen commands sent through a worker port", () => {
  const result = shouldBlock(
    {
      url: "fbpg://MessagePort.postMessage",
      method: "POSTMESSAGE",
      body: {
        operationName: "storiesUpdateSeenStateMutation",
        variables: { bucket_id: "redacted", story_id: "redacted" }
      }
    },
    {
      blockSeen: true,
      blockStorySeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "story-seen-receipt");
});

test("does not block generic worker story metadata", () => {
  const result = shouldBlock(
    {
      url: "fbpg://MessagePort.postMessage",
      method: "POSTMESSAGE",
      body: {
        task: "hydrateStoryViewer",
        story_view_receipt: false
      }
    },
    {
      blockSeen: true,
      blockStorySeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.reason, "no-match");
});

test("does not block realtime story seen packets", () => {
  const result = shouldBlock(
    {
      url: "wss://gateway.facebook.com/ws/realtime",
      method: "WS",
      body: "StoriesCometSuspenseRoot.react comet.stories.viewer story_card_timespent seen_state_triggered story_tray"
    },
    {
      blockSeen: true,
      blockStorySeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.type, "none");
});

test("preserves story-page worker read watermark payloads for stability", () => {
  const result = shouldBlock(
    {
      url: "https://www.facebook.com/stories/1548255111880713/UzpfSVNDOjE2NDAyNjg2OTcwNzkzNzg=/MessagePort.postMessage",
      method: "POSTMESSAGE",
      body: {
        task: "bulkMaybeCreateOrUpdateThread",
        lastReadWatermarkTimestampMs: 1783120000000
      }
    },
    {
      blockSeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.type, "receipt");
  assert.equal(result.reason, "story-receipt-disabled-for-stability");
});

test("does not block normal Facebook story loading payloads", () => {
  for (const body of [
    "fb_api_req_friendly_name=StoriesCometSuspenseRootQuery&variables=%7B%22story_set_type%22%3A%22bucket%22%7D",
    "fb_api_req_friendly_name=StoriesTrayQuery&variables=%7B%22story_bucket%22%3A%22123%22%7D",
    "LSStoryContactSyncFromBucket story_set_type story_bucket story_id",
    "MWV2MediaViewer.react StoriesCometSuspenseRoot.react",
    "entities.ff_js_web.story_card_timespent entities.ff_js_web.story_navigation comet.stories.viewer"
  ]) {
    const result = classifyRequest({
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      body
    });

    assert.equal(result.blocked, false);
    assert.equal(result.type, "none");
  }
});

test("does not block Facebook story creation or upload payloads", () => {
  for (const body of [
    "fb_api_req_friendly_name=CometComposerCreateStoryMutation&variables=%7B%22story_seen%22%3Afalse%7D",
    "create_story upload_story story_seen=false",
    "StoryPublishMutation story_view_receipt=false"
  ]) {
    const result = shouldBlock(
      {
        url: "https://www.facebook.com/api/graphql/",
        method: "POST",
        body
      },
      {
        blockSeen: true,
        blockTyping: true
      }
    );

    assert.equal(result.blocked, false);
  }
});

test("does not block normal message send", () => {
  const result = classifyRequest({
    url: "https://www.facebook.com/api/graphql/",
    method: "POST",
    body: "fb_api_req_friendly_name=MessengerSendMessageMutation&variables=%7B%22body%22%3A%22hello%22%7D"
  });

  assert.equal(result.blocked, false);
});

test("preserves message send requests that contain a receipt marker", () => {
  const result = shouldBlock(
    {
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      body: "fb_api_req_friendly_name=MessengerSendMessageMutation&message_seen=true&variables=%7B%22body%22%3A%22hello%22%7D"
    },
    {
      blockSeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.reason, "preserved-message-send");
});

test("preserves realtime message send frames that contain typing markers", () => {
  const result = shouldBlock(
    {
      url: "wss://gateway.facebook.com/ws/realtime",
      method: "WS",
      body: "composer_send_message secure_composer send_typing_indicators message_type"
    },
    {
      blockSeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.reason, "preserved-message-send");
});

test("blocks realtime typing frames even when bundled with generic thread flow tokens", () => {
  const result = shouldBlock(
    {
      url: "wss://gateway.facebook.com/ws/realtime",
      method: "WS",
      body: "message_thread_events thread_impression thread_fbid send_typing_indicators"
    },
    {
      blockSeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, true);
  assert.equal(result.type, "typing");
});

test("blocks worker chat-state typing commands", () => {
  const result = shouldBlock(
    {
      url: "Worker.postMessage",
      method: "POSTMESSAGE",
      body: {
        task: "backend_sendChatStateFromComposer_start",
        event: "sendChatStateFromComposer.123"
      }
    },
    {
      blockSeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, true);
  assert.equal(result.type, "typing");
});

test("preserves realtime thread flow frames that contain receipt markers", () => {
  const result = shouldBlock(
    {
      url: "wss://gateway.facebook.com/ws/realtime",
      method: "WS",
      body: "message_thread_events thread_impression thread_fbid mark_thread_as_read seen_receipt"
    },
    {
      blockSeen: true,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.reason, "preserved-message-send");
});

test("honors disabled seen blocking setting", () => {
  const result = shouldBlock(
    {
      url: "https://www.facebook.com/ajax/mercury/mark_read.php",
      method: "POST",
      body: ""
    },
    {
      blockSeen: false,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.reason, "receipt-disabled");
});

test("honors disabled seen blocking setting for realtime receipts", () => {
  const result = shouldBlock(
    {
      url: "wss://gateway.facebook.com/ws/lightspeed",
      method: "WS",
      body: "thread_id last_read_watermark_ts"
    },
    {
      blockSeen: false,
      blockTyping: true
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.reason, "receipt-disabled");
});

test("honors disabled typing blocking setting", () => {
  const result = shouldBlock(
    {
      url: "https://www.facebook.com/ajax/mercury/send_typing.php",
      method: "POST",
      body: ""
    },
    {
      blockSeen: true,
      blockTyping: false
    }
  );

  assert.equal(result.blocked, false);
  assert.equal(result.reason, "typing-disabled");
});
