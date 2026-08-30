# Clipboard module (stub)

Status: **disabled by default**. `config/service.json` → `modules.clipboard.enabled`.

Second-largest security surface of the optional modules: arbitrary
clipboard content crossing the trust boundary in either direction. Left
unimplemented deliberately — see reconciliation.md §1.

## What it would need to become real

1. PC-side clipboard read/write via a small native binding
   (`clipboardy` npm package is a reasonable dependency-light choice —
   cross-platform, no native compilation) — but audit it before adopting on
   a production install since it shells out internally on some platforms.
2. Add a `clipboard_sync` WS message type, text-only, with a strict size
   cap (e.g. 4KB) enforced server-side regardless of what the client sends.
3. Rate-limit clipboard sync separately from the general REST limits (§6.1
   table doesn't currently have a row for this — would need one).
4. Never log clipboard content (extend the "never logged" list in
   architecture-security.md §6.2).
