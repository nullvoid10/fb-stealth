(function initMatcherModule(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.FBPG_MATCHERS = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : undefined, function createMatchers() {
  const MAX_TEXT_BYTES = 64 * 1024;

  const RECEIPT_URL_PATTERNS = [
    /\/ajax\/mercury\/change_read_status\.php/i,
    /\/ajax\/mercury\/mark_read\.php/i,
    /\/ajax\/mercury\/read_status/i,
    /\/messaging\/read/i
  ];

  const TYPING_URL_PATTERNS = [
    /\/ajax\/mercury\/send_typing\.php/i,
    /\/messaging\/typing/i
  ];

  const RECEIPT_PAYLOAD_PATTERNS = [
    /\bmark(?:_|-)?(?:as_|as-)?read\b/i,
    /\bmark(?:_|-)?thread(?:_|-)?read\b/i,
    /\bthread(?:_|-)?mark(?:_|-)?read\b/i,
    /\bmarkThreadRead\b/i,
    /\bMarkThreadRead\b/,
    /\bread(?:_|-)?receipt\b/i,
    /\breadReceipt\b/,
    /\bReadReceipt\w*\b/,
    /\bmessage(?:_|-)?seen\b/i,
    /\bmessageSeen\b/,
    /\bseen(?:_|-)?receipt\b/i,
    /\blast(?:_|-)?read\w*\b/i,
    /\bread(?:_|-)?watermark\b/i,
    /\breadWatermark\b/,
    /\bReadWatermark\w*\b/,
    /\bMercuryMarkThreadRead\w*\b/,
    /\bCometMessengerMarkThreadRead\w*\b/,
    /\bMWChatMarkThreadRead\w*\b/,
    /\bMWThreadMarkRead\w*\b/,
    /\bMessengerThreadMarkRead\w*\b/,
    /\bCometMessengerSeen\w*\b/,
    /\bMWChatSeen\w*\b/,
    /\/read(?:_|-)?receipt/i,
    /\/mark(?:_|-)?read/i,
    /\/mercury_read/i
  ];

  const STORY_RECEIPT_PAYLOAD_PATTERNS = [
    /\bstoriesUpdateSeenStateMutation\b/i,
    /\bCometStoriesMarkSeen\w*\b/,
    /\bStoriesMarkStorySeen\w*\b/,
    /\bmark(?:_|-)?stor(?:y|ies)(?:_|-)?(?:seen|viewed)\b/i,
    /\bstor(?:y|ies)(?:_|-)?(?:seen|view)(?:_|-)?receipt\b/i,
    /\bstory(?:_|-)?viewer(?:_|-)?seen\b/i
  ];

  const TYPING_PAYLOAD_PATTERNS = [
    /\bsend(?:_|-)?typing\w*\b/i,
    /\bset(?:_|-)?typing\b/i,
    /\btyping(?:_|-)?state\b/i,
    /\btyping(?:_|-)?indicator\b/i,
    /\btypingIndicator\b/,
    /\bTypingIndicator\w*\b/,
    /\bis(?:_|-)?typing\b/i,
    /\btyping(?:_|-)?status\b/i,
    /\bcompos(?:e|ing|ition)(?:_|-)?(?:status|state|indicator)?\b/i,
    /\bis(?:_|-)?compos(?:e|ing)\b/i,
    /\bkeyboard(?:_|-)?activity\b/i,
    /\buser(?:_|-)?activity(?:_|-)?update\b/i,
    /\bsend(?:_|-)?chat(?:_|-)?state(?:_|-)?from(?:_|-)?composer\b/i,
    /\bsendChatStateFromComposer\b/,
    /\bbackend(?:_|-)?sendChatStateFromComposer\b/i,
    /\bfireAndForget\.backend\.sendChatStateFromComposer\b/i,
    /\breceive\.handled\.backend\.sendChatStateFromComposer\b/i,
    /\bCometMessengerTyping\w*\b/,
    /\bMessengerTyping\w*\b/,
    /\bMWChatTyping\w*\b/,
    /\bMercurySendTyping\w*\b/,
    /\bCometTypingIndicator\w*\b/,
    /\bMWV2ChatTyping\w*\b/,
    /\/thread_typing/i,
    /\/orca_typing_notifications/i,
    /\/typing/i
  ];

  const MESSAGE_SEND_PATTERNS = [
    /\bsend(?:_|-)?message\b/i,
    /\bcomposer(?:_|-)?send(?:_|-)?message\b/i,
    /\bcomposer_send_message\w*\b/i,
    /\bsecure(?:_|-)?composer\b/i,
    /\bSendMessage\w*\b/,
    /\bMessengerSendMessage\w*\b/,
    /\bCometMessengerSendMessage\w*\b/,
    /\bMWChatSendMessage\w*\b/,
    /\bmessage_batch\b/i
  ];

  const CRITICAL_MESSAGE_FLOW_PATTERNS = [
    /\bbulk(?:_|-)?create(?:_|-)?thread\b/i,
    /\bcreate(?:_|-)?thread\b/i,
    /\bMAWSecureThread\w*\b/,
    /\bSecureThread\w*\b/,
    /\bThreadDetail\w*\b/,
    /\bLS(?:Insert|Upsert|Update|Delete|Clear|Truncate)\w*\b/,
    /\bmessage(?:_|-)?thread(?:_|-)?events\b/i,
    /\bthread(?:_|-)?impression\b/i
  ];

  const STORY_PUBLISH_PAYLOAD_PATTERNS = [
    /\bcreate(?:_|-)?story\b/i,
    /\bstory(?:_|-)?create\b/i,
    /\bupload(?:_|-)?story\b/i,
    /\bstory(?:_|-)?upload\b/i,
    /\bpublish(?:_|-)?story\b/i,
    /\bstory(?:_|-)?publish\b/i,
    /\b\w*CreateStory\w*\b/,
    /\b\w*StoryCreate\w*\b/,
    /\b\w*UploadStory\w*\b/,
    /\b\w*StoryUpload\w*\b/,
    /\b\w*PublishStory\w*\b/,
    /\b\w*StoryPublish\w*\b/
  ];

  function toText(value) {
    if (value == null) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (value instanceof URLSearchParams) {
      return value.toString();
    }

    if (typeof FormData !== "undefined" && value instanceof FormData) {
      const pairs = [];
      for (const [key, item] of value.entries()) {
        const safeValue = typeof item === "string" ? item : "[file]";
        pairs.push(`${key}=${safeValue}`);
      }
      return pairs.join("&");
    }

    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return "";
    }

    if (value instanceof ArrayBuffer) {
      return decodeTextBytes(new Uint8Array(value));
    }

    if (ArrayBuffer.isView(value)) {
      return decodeTextBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }

    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }

  function hasAny(patterns, text) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function decodeTextBytes(bytes) {
    return new TextDecoder().decode(bytes.slice(0, MAX_TEXT_BYTES));
  }

  function decodeLoose(text) {
    try {
      return decodeURIComponent(text.replace(/\+/g, " "));
    } catch (_error) {
      return text;
    }
  }

  function isStorySurface(url) {
    const value = decodeLoose(toText(url));
    return /(^|[./])facebook\.com\/stories(?:\/|$)/i.test(value) || /^\/stories(?:\/|$)/i.test(value);
  }

  function isGraphqlUrl(url) {
    return /\/api\/graphql\/?/i.test(decodeLoose(toText(url)));
  }

  function classifyRequest(input) {
    const url = toText(input && input.url);
    const body = toText(input && input.body);
    const topic = toText(input && input.topic);
    const haystack = `${url}\n${topic}\n${body}\n${decodeLoose(url)}\n${decodeLoose(topic)}\n${decodeLoose(body)}`;
    const isMessageSend = hasAny(MESSAGE_SEND_PATTERNS, haystack);
    const isStoryPublish = hasAny(STORY_PUBLISH_PAYLOAD_PATTERNS, haystack);
    const isStoryReceipt = isGraphqlUrl(url) && hasAny(STORY_RECEIPT_PAYLOAD_PATTERNS, haystack);
    const isCriticalReceiptFlow = isMessageSend || isStoryPublish || hasAny(CRITICAL_MESSAGE_FLOW_PATTERNS, haystack);

    if (hasAny(TYPING_URL_PATTERNS, url) || hasAny(TYPING_PAYLOAD_PATTERNS, haystack)) {
      return {
        blocked: true,
        type: "typing",
        reason: isMessageSend ? "typing-inside-message-send" : "typing-indicator",
        safeToBlock: !isMessageSend
      };
    }

    if (isStoryReceipt && !isStoryPublish) {
      return {
        blocked: true,
        type: "receipt",
        reason: "story-seen-receipt",
        safeToBlock: true
      };
    }

    if (hasAny(RECEIPT_URL_PATTERNS, url) || hasAny(RECEIPT_PAYLOAD_PATTERNS, haystack)) {
      return {
        blocked: true,
        type: "receipt",
        reason: isCriticalReceiptFlow ? "receipt-inside-message-flow" : "read-receipt",
        safeToBlock: !isCriticalReceiptFlow
      };
    }

    return {
      blocked: false,
      type: "none",
      reason: "no-match",
      safeToBlock: false
    };
  }

  function shouldBlock(input, settings) {
    const result = classifyRequest(input);

    if (!result.blocked) {
      return result;
    }

    if (result.type === "receipt" && isStorySurface(input && input.url)) {
      return {
        ...result,
        blocked: false,
        reason: "story-receipt-disabled-for-stability"
      };
    }

    if (result.reason === "story-seen-receipt" && !(settings && settings.blockStorySeen)) {
      return {
        ...result,
        blocked: false,
        reason: "story-seen-disabled"
      };
    }

    if (result.type === "typing" && !(settings && settings.blockTyping)) {
      return {
        ...result,
        blocked: false,
        reason: "typing-disabled"
      };
    }

    if (result.type === "receipt" && !(settings && settings.blockSeen)) {
      return {
        ...result,
        blocked: false,
        reason: "receipt-disabled"
      };
    }

    if (result.blocked && !result.safeToBlock) {
      return {
        ...result,
        blocked: false,
        reason: "preserved-message-send"
      };
    }

    return result;
  }

  return {
    classifyRequest,
    shouldBlock,
    toText
  };
});
