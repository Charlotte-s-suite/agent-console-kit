# Porting the crown-jewel components (HeadTerminal + Composer)

These two carry the real value but hardcode HQ specifics. The parameterization to move them here:

## HeadTerminal (the PTY-over-SSE + xterm.js engine)
Coupling to remove:
- **Route prefix**: hardcoded `/api/hq/term/*` → accept `apiBase: string` prop (default `/api/hq/term`).
- **Target concept**: `head`-named target → `sessionTarget: string` (a head name, a site id, whatever the
  host app resolves server-side). The component never resolves it; it POSTs it.
- **Shared draft**: the chat⟷TUI "shared draft" is HQ's dual-view feature → make it an optional
  `draft?/onDraft?` pair; a pure-terminal consumer (Merritt site console) just omits it.
- Portable as-is: the resize/font-fit math, key-bar, sticky-ctrl, touch-scroll-to-wheel, SSE drain.
Add during this pass (both apps want it): **head lifecycle** — spawn / kill / rename / re-seed via new
`/…/lifecycle` calls, so a site console can create its own agent without the box TUI.

## Composer (chat input)
Coupling to remove:
- Hardcoded `/api/hq/head/:name/{input,upload}` and `/api/hq/commands` → `apiBase` + a
  `commandsFetcher?: () => Promise<Command[]>` prop (Merritt may have a different/empty command catalog).
- `draft`/`onDraft` contract already generic — keep.

## HeadConsole (the per-agent chat blueprint) — generalize, don't lift verbatim
Its shape is right (poll transcript → reconcile optimistic bubbles → render menu prompts → embed
Composer+StatusLine) but its `ConsoleBlock` union is tuned to Claude Code's exact tool/thinking/diff/ask
taxonomy. Generalize the block-kind union (or make it a generic `<TBlock>`), then it becomes the base for
any per-agent console.

## The small controls (StatusLine / InterruptButton / ModeToggle / ModelSelector / ConsolidateRefreshButton)
Each couples only to one endpoint + a `name` prop → add `apiBase` + rename `name`→`sessionTarget`. Cheap.
**Also add here**: the *gated bypass* action (HQ audit finding — bypass can't be set from the UI today);
build it once, both apps get safe bypass control.

## Sequence
1. Parameterize HeadTerminal + Composer **inside HQ** (props with HQ defaults — zero behavior change).
2. Move them here; HQ imports them back from the kit (thin, low-risk).
3. Merritt imports them fresh with its own `apiBase`.
4. Add lifecycle + gated-bypass in the kit → both apps gain them at once.
