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
"dependencies": { "@charlotte/agent-console-kit": "github:Charlotte-s-suite/agent-console-kit#v0.2.0" }
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

## v0.4 — comprehensive accessory bar + sticky modifiers + tmux chords

The TUI accessory bar is now full raw-terminal grade (for HQ's WSL/tmux panes):
- **Sticky modifiers Ctrl / Alt / ⇧** — arm one or several; the next key (from the bar OR the native
  keyboard) composes then auto-disarms. Ctrl→control byte (⌃A…⌃Z, ⌃Space=NUL), Alt→ESC-prefix,
  Shift→shifted/upper. So any `Ctrl+X` / `Alt+X` the phone keyboard can't emit is reachable.
- **tmux ⌃B prefix** button (+ Shift+Tab→back-tab) and an expandable **⋯ tray**: Home/End/PgUp/PgDn/
  Del/Ins, one-tap ^C…^W, tmux chords (new-window/split/zoom/pane-nav/detach/copy), F1–F12, and the
  symbols phones bury (`| ~ \` \\ / { } [ ] < > _ # $ * &`).
The native keyboard's `onKeyDown`/`onInput` route through the same modifier state, so composing works
whether you tap a bar key or type. `HeadTerminal`'s prop surface is unchanged from v0.3.

## v0.3 — one terminal, one live keyboard (⚠️ breaking)

The TUI input model was overhauled (Schyler, 2026-07-03): the dual message-box + collapsible
on-screen QWERTY that muddled "type a message" with "drive the terminal live" is **gone**. The
terminal is now **LIVE-ONLY** — a single input summons the phone's NATIVE keyboard and forwards
every keystroke straight to the PTY, with a slim **accessory bar** (Esc/Tab/Ctrl/arrows/`|`/`~`/^C…)
for the keys phones lack, also live. Composing a MESSAGE is the chat view's `Composer`, a separate
surface. Identical for `pane` and `shell`.

**Breaking:** `HeadTerminal` dropped `draft` / `onDraft` / `messageApiBase` (it no longer sends
messages). Consumers that had a chat⟷TUI shared draft: keep the draft on the chat `Composer`; the
terminal doesn't take one. `TuiKeyboard` is still exported but no longer used internally.

- `HeadTerminal { sessionTarget, apiBase='/api/hq/term', kind, active, interactive?, showControls?, onClose?, onError? }`
  — POSTs `{"head": sessionTarget}` to `${apiBase}/open`; engine routes are
  `${apiBase}/{spawn,open}` + `${apiBase}/{sid}/{stream,input,resize,scrub,close}`. Requires the
  `xterm` peer dep.
- `Composer { sessionTarget, apiBase='/api/hq', commandsFetcher?, onSent?, draft?/onDraft?, suggest? }`
  — unchanged; sends to `${apiBase}/head/{sessionTarget}/{input,upload}`, catalog `${apiBase}/commands`.

The wire keeps the `head` path/body key until a coordinated contract rename. Head-lifecycle CONTROLS
(spawn/kill/rename UI — hydra-hq PR #121's `LifecyclePanel` + `POST /lifecycle`) stay host-side for now.

## The model going forward

1. **New shared behavior lands HERE first**, then both apps consume it.
2. **HQ migrates its imports to this package** during the parameterize pass — after that, an improvement
   in either app flows to both (bidirectional single-source).
3. Until HQ migrates, this kit is seeded FROM HQ and is the canonical copy for Merritt; the two won't
   drift because Merritt never forks — it imports.

_Extracted 2026-07-02 by Charlotte-Fable from hydra-hq during the HQ audit. Merritt: stop building an
agent console from scratch — this is it._
