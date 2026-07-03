# @charlotte/agent-console-kit

The reusable core of the **Hydra HQ console**, extracted so `hydra-hq` and `merritt` (and any future
agent-driving app) share **one source of truth** instead of drifting copies.

## Why this exists — and the answer to "do upgrades propagate?"

**Yes — because both apps import from HERE, not from a copy.** Fix a bug in the terminal engine or the
markdown renderer once, bump the version, both apps pull it. This is the deliberate opposite of forking
the files (which is how the HQ *daemons* drifted from their repo — a mistake we're not repeating in the
frontend).

**Consume it (in hydra-hq or merritt `package.json`):**
```json
"dependencies": { "@charlotte/agent-console-kit": "github:Charlotte-s-suite/agent-console-kit#v0.1.0" }
```
Upgrade both apps with a version bump + `npm update`. (Or a git submodule if you prefer vendoring.)

## What's in it NOW (v0.1 — the genuinely drop-in components)

| Export | What it is | Coupling |
|---|---|---|
| `TuiKeyboard` | full on-screen QWERTY for phone TUI control (esc/tab/arrows/ctrl/shift/caps) | none — emits via `onBytes` |
| `RichMarkdown` | security-reviewed chat renderer: tables, syntax-highlit code, diffs, images | none |
| `tokenize` / `C` / `safeUrl` | the renderer's syntax highlighter, design tokens, XSS-safe URL guard | none |
| `visiblePoll` | polling hook that pauses on hidden tabs + catch-up refresh on focus | none |
| `useMediaQuery` / `useIsMobile` | viewport hooks for inline-styled components | none (MOBILE_QUERY inlined) |

All verbatim from HQ, dependency-free beyond React. `sanitizeUrl.test.ts` ships too — the one piece of
the console with real test coverage; keep it green.

## The port roadmap (what comes next — see PORTING.md)

The **crown jewel** — `HeadTerminal` (mirror any PTY over SSE + xterm.js: byte stream, resize
negotiation, key-bar, sticky-ctrl, touch-scroll-to-wheel) — and `Composer` (slash-autocomplete,
attachments, draft-lifting) are **not yet here** because they hardcode HQ's `/api/hq/*` routes and a
`head`-named target. They move here after a small parameterization pass (route-prefix + `sessionTarget`
as props) so both apps share one engine. That refactor is HQ audit item #7 and is the natural moment to
also add head-lifecycle controls (spawn/kill/rename) that Merritt needs anyway.

## The model going forward

1. **New shared behavior lands HERE first**, then both apps consume it.
2. **HQ migrates its imports to this package** during the parameterize pass — after that, an improvement
   in either app flows to both (bidirectional single-source).
3. Until HQ migrates, this kit is seeded FROM HQ and is the canonical copy for Merritt; the two won't
   drift because Merritt never forks — it imports.

_Extracted 2026-07-02 by Charlotte-Fable from hydra-hq during the HQ audit. Merritt: stop building an
agent console from scratch — this is it._
