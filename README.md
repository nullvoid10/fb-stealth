# FB Stealth

Plain JavaScript Chrome Manifest V3 extension for best-effort Facebook and Messenger privacy controls.

## Features

- Best-effort blocking for seen/read receipts in Messenger chats.
- Optional experimental best-effort Facebook story seen blocking.
- Best-effort blocking for typing indicators.
- Per-tab quick pause.
- Privacy-safe protection stats for Messenger seen, story seen, and typing.
- Optional debug mode with sanitized console diagnostics.

Changing the seen/read-receipt setting reloads Facebook automatically so Facebook rebuilds its in-memory thread state. Typing changes apply without a reload.

Facebook story seen blocking is separate from Messenger seen blocking. It only blocks the GraphQL story seen-state mutation because blocking realtime or worker story traffic can freeze Facebook. Leave it off unless you are actively testing stories.

FB Stealth is unofficial and not affiliated with Meta, Facebook, or Messenger. See [DISCLAIMER.md](DISCLAIMER.md).

## Privacy

- Permissions are limited to `storage` plus Facebook/Messenger host access.
- Settings are stored in `chrome.storage.sync`.
- Protection counters are stored in `chrome.storage.local` as totals and timestamps only.
- Per-tab pause state is stored in `chrome.storage.session`.
- The extension does not store message text, story content, names, profile URLs, thread IDs, story IDs, cookies, or credentials.
- Debug mode prints sanitized request classifications to the console only. It does not expose page-readable export globals.

## Security

Please report privacy or security issues using the guidance in [SECURITY.md](SECURITY.md). Do not include private messages, account identifiers, cookies, tokens, screenshots with personal data, or other sensitive information in reports.

## License

This project is licensed under the [MIT License](LICENSE).

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the local `fb-stealth` project folder.

## Development

```sh
npm test
```

Facebook changes internal request names often. Update `src/shared/matchers.js` when a new read-receipt or typing signal appears. Debug mode prints sanitized request classifications to the page console, but it does not expose export functions or store message content.

After editing the extension, open `arc://extensions`, press Reload on FB Stealth, then reload every open Facebook/Messenger tab.
