# Security Policy

## Reporting a Vulnerability

Please report privacy or security issues by opening a GitHub issue.

Do not include private messages, message text, story content, account
identifiers, profile URLs, cookies, tokens, screenshots with personal data, or
other sensitive information in reports.

Useful reports include:

- The browser name and version.
- The FB Stealth version.
- Which protection setting was enabled.
- Whether the issue affects seen receipts, story seen, typing indicators,
  counters, settings, or diagnostics.
- Sanitized steps to reproduce the issue.

## Scope

Security and privacy issues in scope include:

- Message or story content being stored or exposed.
- Cookies, tokens, credentials, profile URLs, thread IDs, or story IDs being
  stored or exposed.
- Facebook page scripts being able to disable protection settings.
- Broken counter isolation or incorrect privacy-summary storage.
- Extension behavior that causes Facebook or Messenger to stop loading normally.

## Out of Scope

Facebook changing internal request names or web behavior is expected and may
break blocking until matcher rules are updated. Please report those as normal
bugs unless they expose private data.
